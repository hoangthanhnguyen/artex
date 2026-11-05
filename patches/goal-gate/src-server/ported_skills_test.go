package server

import (
	"path/filepath"
	"testing"

	"github.com/Autumn-27/norma/skill"
)

// The skills ported from the 0.4.0 fork must parse with the real frontmatter
// loader and carry a description, otherwise the agents silently cannot discover
// them. Ported: api-security, bbot-recon, codeaudit, edr-bypass-re, patch-diff,
// php2shell, rea.
func TestPortedSkillsParseCleanly(t *testing.T) {
	dir := filepath.Join("..", "skills")
	reg, err := skill.LoadDir(dir)
	if err != nil {
		t.Fatalf("LoadDir: %v", err)
	}
	byDir := map[string]skill.Skill{}
	if reg != nil {
		for _, sk := range reg.List() {
			if sk.Dir != "" {
				byDir[filepath.Base(sk.Dir)] = sk
			}
		}
	}
	for _, name := range []string{"api-security", "bbot-recon", "codeaudit", "edr-bypass-re", "patch-diff", "php2shell", "rea"} {
		sk, ok := byDir[name]
		if !ok {
			t.Errorf("skill %s: not parsed by LoadDir (frontmatter broken?)", name)
			continue
		}
		if sk.Description == "" {
			t.Errorf("skill %s: empty description after parse", name)
		}
		t.Logf("skill %s ok: name=%q desc=%d chars", name, sk.Name, len(sk.Description))
	}
}
