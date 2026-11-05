package server

import "testing"

// The target-presence gate only rejects goals that name no dispatchable target.
// A short but concrete goal must pass: the upstream fork's 80-character floor
// is deliberately not ported, so these cases pin that decision.
func TestGoalGateCheck(t *testing.T) {
	pass := []string{
		"test https://lab.local/login for IDOR with a second account",
		"test https://lab.local for IDOR", // short but concrete: must still pass
		"audit 10.0.0.5:8080",
		"check example.com for subdomain takeover",
		"probe localhost:3000 for authz bugs",
		"review /api/v1/users for missing authorization",
		"[targetless] summarise the provided source tree for trust-boundary mistakes",
	}
	for _, g := range pass {
		if err := goalGateCheck(g); err != nil {
			t.Errorf("goalGateCheck(%q) = %v, want nil", g, err)
		}
	}

	fail := []string{
		"",
		"   ",
		"find vulnerabilities",
		"audit the site thoroughly and report everything you discover about it",
	}
	for _, g := range fail {
		if err := goalGateCheck(g); err == nil {
			t.Errorf("goalGateCheck(%q) = nil, want an error", g)
		}
	}
}
