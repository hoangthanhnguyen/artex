package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrintfPreservation(t *testing.T) {
	for _, tc := range []struct { original, english string; valid bool }{
		{"错误 %s: %w", "Error %s: %w", true},
		{"值 %03d %% %[2]s", "Value %03d %% %[2]s", true},
		{"错误 %s: %w", "Error %w: %s", false},
		{"错误 %s", "Error", false},
		{"错误", "错误", false},
		{"\n错误 %s: ", "\nError %s: ", true},
		{"\n错误 %s: ", "Error %s:", false},
		{"错误 %[3]*.[2]*[1]f", "Error %[3]*.[2]*[1]f", true},
	} {
		if got := validateTranslation(tc.original, tc.english) == nil; got != tc.valid {
			t.Errorf("validation=%v, want %v", got, tc.valid)
		}
	}
}

func fixture(t *testing.T, files map[string]string, dict map[string]string) (string, string) {
	t.Helper()
	root, tables := t.TempDir(), t.TempDir()
	for name, text := range files {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil { t.Fatal(err) }
		if err := os.WriteFile(path, []byte(text), 0644); err != nil { t.Fatal(err) }
	}
	data, _ := json.Marshal(dict)
	if err := os.WriteFile(filepath.Join(tables, "backend-reviewed.json"), data, 0644); err != nil { t.Fatal(err) }
	return root, tables
}

func TestNoPartialWriteAndReport(t *testing.T) {
	files := map[string]string{"a.go": "package sample\nvar A = `错误 %s`", "z.go": "package sample\nvar Z = `未知错误`"}
	root, tables := fixture(t, files, map[string]string{"错误 %s": "Error %s"})
	var report bytes.Buffer
	if err := run(root, tables, "--report", &report); err != nil { t.Fatal(err) }
	if !strings.Contains(report.String(), `"status":"untranslated"`) { t.Fatal("missing gap record") }
	if err := run(root, tables, "", &bytes.Buffer{}); err == nil { t.Fatal("accepted incomplete coverage") }
	for name, before := range files {
		after, _ := os.ReadFile(filepath.Join(root, name))
		if string(after) != before { t.Fatalf("partially rewrote %s", name) }
	}
}

func TestPreservationAndIdempotence(t *testing.T) {
	input := "package sample\n// 错误 %s\nvar A = `错误 %s`\nvar M = map[string]string{`错误 %s`: `错误 %s`}\nfunc f(s string) bool { switch s { case `错误 %s`: return s == `错误 %s` }; return false }"
	testInput := "package sample\nvar Fixture = `错误 %s`"
	root, tables := fixture(t, map[string]string{"a.go": input, "a_test.go": testInput}, map[string]string{"错误 %s": "Error %s"})
	if err := run(root, tables, "--check", &bytes.Buffer{}); err == nil { t.Fatal("check accepted pending edits") }
	if err := run(root, tables, "", &bytes.Buffer{}); err != nil { t.Fatal(err) }
	after, _ := os.ReadFile(filepath.Join(root, "a.go"))
	for _, kept := range []string{"// 错误 %s", "map[string]string{`错误 %s`:", "case `错误 %s`:", "s == `错误 %s`"} {
		if !strings.Contains(string(after), kept) { t.Fatalf("changed protected code: %s", kept) }
	}
	if strings.Count(string(after), `"Error %s"`) != 2 { t.Fatal("did not translate only output values") }
	fixtureAfter, _ := os.ReadFile(filepath.Join(root, "a_test.go"))
	if string(fixtureAfter) != testInput { t.Fatal("rewrote arbitrary test fixture") }
	if err := run(root, tables, "--check", &bytes.Buffer{}); err != nil { t.Fatal(err) }
	if err := run(root, tables, "", &bytes.Buffer{}); err != nil { t.Fatal(err) }
	second, _ := os.ReadFile(filepath.Join(root, "a.go"))
	if !bytes.Equal(after, second) { t.Fatal("second run changed output") }
}

func TestScopedPreservationAndExpectation(t *testing.T) {
	root, tables := fixture(t, map[string]string{
		"a.go": "package sample\nvar Pattern = `错误`",
		"a_test.go": "package sample\nvar Expected = `错误`\nvar Fixture = `测试数据`",
	}, map[string]string{"错误": "Error", "测试数据": "Test data"})
	for name, rules := range map[string][]reviewRule{
		"backend-preserve.json": {{File: "a.go", Text: "错误", Reason: "matching constant"}},
		"backend-test-expectations.json": {{File: "a_test.go", Text: "错误", Reason: "reviewed error assertion"}},
	} {
		body, _ := json.Marshal(rules)
		if err := os.WriteFile(filepath.Join(tables, name), body, 0644); err != nil { t.Fatal(err) }
	}
	if err := run(root, tables, "", &bytes.Buffer{}); err != nil { t.Fatal(err) }
	production, _ := os.ReadFile(filepath.Join(root, "a.go"))
	if !strings.Contains(string(production), "`错误`") { t.Fatal("changed scoped matcher") }
	testBody, _ := os.ReadFile(filepath.Join(root, "a_test.go"))
	if !strings.Contains(string(testBody), `"Error"`) || !strings.Contains(string(testBody), "`测试数据`") { t.Fatal("test update escaped reviewed scope") }
}
