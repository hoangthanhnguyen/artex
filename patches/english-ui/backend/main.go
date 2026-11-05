// Localize reviewed application-owned Go literals; never rewrite matchers or fixtures.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

type edit struct {
	start, end int
	text       string
}

type literal struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Text    string `json:"text"`
	Context string `json:"context"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
}

// Review rules are occurrence-scoped: the same text elsewhere is not exempted.
type reviewRule struct {
	File   string `json:"file"`
	Text   string `json:"text"`
	Reason string `json:"reason"`
}

type fileWrite struct {
	path string
	body []byte
	mode os.FileMode
}

var printfVerb = regexp.MustCompile(`%(?:\[[0-9]+\])?[+# \-0]*(?:[0-9]+|\*|\[[0-9]+\]\*)?(?:\.(?:[0-9]+|\*|\[[0-9]+\]\*))?(?:\[[0-9]+\])?[a-zA-Z%]`)

func chinese(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func padding(s string) (string, string) {
	return s[:len(s)-len(strings.TrimLeftFunc(s, unicode.IsSpace))], s[len(strings.TrimRightFunc(s, unicode.IsSpace)):]
}

func validateTranslation(original, english string) error {
	if chinese(english) || strings.TrimSpace(english) == "" {
		return fmt.Errorf("translation is empty or contains Han characters")
	}
	if !reflect.DeepEqual(printfVerb.FindAllString(original, -1), printfVerb.FindAllString(english, -1)) {
		return fmt.Errorf("printf verbs changed")
	}
	a, b := padding(original)
	c, d := padding(english)
	if a != c || b != d {
		return fmt.Errorf("leading or trailing whitespace changed")
	}
	return nil
}

func loadJSON(path string, value any, optional bool) error {
	body, err := os.ReadFile(path)
	if optional && os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, value); err != nil {
		return fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	return nil
}

func ruleKey(file, text string) string { return file + "\x00" + text }

func callName(node ast.Node) string {
	call, ok := node.(*ast.CallExpr)
	if !ok {
		return ""
	}
	switch fun := call.Fun.(type) {
	case *ast.Ident:
		return fun.Name
	case *ast.SelectorExpr:
		return fun.Sel.Name
	}
	return ""
}

func contextName(stack []ast.Node) string {
	for i := len(stack) - 2; i >= 0; i-- {
		if name := callName(stack[i]); name != "" {
			return name
		}
	}
	return "literal"
}

func preserveReason(file string, lit *ast.BasicLit, stack []ast.Node) string {
	if strings.HasSuffix(file, "_test.go") {
		return "test fixture; updates require a file-scoped expectation review"
	}
	for i := len(stack) - 2; i >= 0; i-- {
		switch node := stack[i].(type) {
		case *ast.KeyValueExpr:
			if node.Key == lit {
				return "map or object key; preserve matching and stored-data compatibility"
			}
		case *ast.BinaryExpr:
			if node.Op == token.EQL || node.Op == token.NEQ {
				return "comparison operand; preserve matching behavior"
			}
		case *ast.CaseClause:
			for _, value := range node.List {
				if value == lit {
					return "switch match; preserve matching behavior"
				}
			}
			// Do not classify output strings in the case body as matching tokens.
		}
	}
	// Call arguments and named constants are not heuristically exempted: SQL,
	// regular expressions and nested matching expressions need explicit review.
	return ""
}

func run(root, tables, mode string, output io.Writer) error {
	dict := map[string]string{}
	// Frontend dictionaries are deliberately not imported: a UI label can also
	// be a protocol key in Go. Backend strings require their own review.
	for i, name := range []string{"backend-reviewed.json", "backend-server.json", "backend-agent.json", "backend-other.json"} {
		entries := map[string]string{}
		if err := loadJSON(filepath.Join(tables, name), &entries, i != 0); err != nil {
			return err
		}
		for original, english := range entries {
			if err := validateTranslation(original, english); err != nil {
				return fmt.Errorf("%s dictionary entry: %w", name, err)
			}
			if prior, ok := dict[original]; ok && prior != english {
				return fmt.Errorf("conflicting backend translations in %s", name)
			}
			dict[original] = english
		}
	}
	var rules, expectations []reviewRule
	if err := loadJSON(filepath.Join(tables, "backend-preserve.json"), &rules, true); err != nil {
		return err
	}
	if err := loadJSON(filepath.Join(tables, "backend-test-expectations.json"), &expectations, true); err != nil {
		return err
	}
	preserved, testUpdates := map[string]string{}, map[string]bool{}
	for _, rule := range rules {
		if rule.File == "" || rule.Text == "" || rule.Reason == "" {
			return fmt.Errorf("preservation rule must include file, text and reason")
		}
		preserved[ruleKey(rule.File, rule.Text)] = rule.Reason
	}
	for _, rule := range expectations {
		if !strings.HasSuffix(rule.File, "_test.go") || rule.Reason == "" || dict[rule.Text] == "" {
			return fmt.Errorf("test expectation needs a test path, reason and reviewed translation")
		}
		testUpdates[ruleKey(rule.File, rule.Text)] = true
	}
	var records []literal
	var writes []fileWrite
	changed, replacements, gaps, kept := 0, 0, 0, 0
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == "web" || entry.Name() == ".git" || entry.Name() == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		set := token.NewFileSet()
		tree, err := parser.ParseFile(set, path, body, 0)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		file := filepath.ToSlash(rel)
		var edits []edit
		var stack []ast.Node
		ast.Inspect(tree, func(node ast.Node) bool {
			if node == nil {
				stack = stack[:len(stack)-1]
				return false
			}
			stack = append(stack, node)
			lit, ok := node.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			text, err := strconv.Unquote(lit.Value)
			if err != nil || !chinese(text) {
				return true
			}
			record := literal{File: file, Line: set.Position(lit.Pos()).Line, Text: text, Context: contextName(stack)}
			reason := preserveReason(file, lit, stack)
			key := ruleKey(file, text)
			if reviewedReason := preserved[key]; reviewedReason != "" {
				reason = reviewedReason
			}
			if strings.HasSuffix(file, "_test.go") && testUpdates[key] {
				reason = ""
			}
			english, found := dict[text]
			switch {
			case reason != "":
				record.Status, record.Reason = "preserved", reason
				kept++
			case found:
				record.Status = "translated"
				edits = append(edits, edit{set.Position(lit.Pos()).Offset, set.Position(lit.End()).Offset, strconv.Quote(english)})
			default:
				record.Status = "untranslated"
				gaps++
			}
			records = append(records, record)
			return true
		})
		if len(edits) == 0 {
			return nil
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		result := string(body)
		for _, edit := range edits {
			result = result[:edit.start] + edit.text + result[edit.end:]
		}
		if _, err := parser.ParseFile(token.NewFileSet(), path, result, 0); err != nil {
			return fmt.Errorf("localized syntax: %w", err)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		writes = append(writes, fileWrite{path, []byte(result), info.Mode().Perm()})
		changed++
		replacements += len(edits)
		return nil
	})
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(output)
	if err := encoder.Encode(map[string]int{"filesChanged": changed, "replacements": replacements, "untranslatedLiterals": gaps, "preservedLiterals": kept}); err != nil {
		return err
	}
	if mode == "--report" {
		return encoder.Encode(records)
	}
	if gaps != 0 || (mode == "--check" && changed != 0) {
		return fmt.Errorf("localization incomplete: %d unreviewed production literals, %d files need translation; no files written", gaps, changed)
	}
	if mode == "--check" {
		return nil
	}
	// All parsing, coverage and formatting validation completes before any write.
	for _, write := range writes {
		if err := os.WriteFile(write.path, write.body, write.mode); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	if len(os.Args) < 3 || len(os.Args) > 4 {
		fmt.Fprintln(os.Stderr, "usage: backend <source-root> <dictionary-dir> [--report|--check]")
		os.Exit(2)
	}
	mode := ""
	if len(os.Args) == 4 {
		mode = os.Args[3]
		if mode != "--report" && mode != "--check" {
			fmt.Fprintln(os.Stderr, "unknown localization mode")
			os.Exit(2)
		}
	}
	if err := run(os.Args[1], os.Args[2], mode, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
