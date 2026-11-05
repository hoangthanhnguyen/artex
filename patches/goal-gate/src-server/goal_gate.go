package server

import (
	"errors"
	"regexp"
	"strings"
)

// Ambiguity gate: a task goal must name a concrete target before any token is
// spent. The failure this guards against: a task whose goal named no target
// passed creation silently and the planner sent every worker to an unrelated
// asset. A goal that is deliberately target-less (pure analysis over provided
// material) opts out with the literal marker [targetless].
//
// The upstream fork this comes from also rejected goals under 80 characters.
// That length floor is deliberately NOT ported: a short but concrete goal
// ("test https://lab.local for IDOR") is perfectly testable, and rejecting it
// forces padding. Only the target-presence rule survives here.
var (
	goalTargetlessRE = regexp.MustCompile(`\[targetless\]`)
	goalURLRE        = regexp.MustCompile(`(?i)\bhttps?://\S+`)
	goalDomainRE     = regexp.MustCompile(`(?i)\b[a-z0-9][a-z0-9-]{1,61}\.[a-z]{2,}(:[0-9]+)?(/\S*)?\b`)
	goalIPv4RE       = regexp.MustCompile(`\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b`)
	goalLocalhostRE  = regexp.MustCompile(`(?i)\blocalhost:[0-9]+\b`)
	goalPathRE       = regexp.MustCompile(`(?i)(^|\s)/[a-z0-9_-]+(/[a-z0-9_.-]+)+`)
)

// goalGateCheck returns a descriptive error when the goal names no target to
// dispatch workers against. Order: explicit opt-out, then target presence
// (URL, domain, IPv4, localhost:port, or absolute path).
func goalGateCheck(goal string) error {
	g := strings.TrimSpace(goal)
	if goalTargetlessRE.MatchString(g) {
		return nil
	}
	if goalURLRE.MatchString(g) || goalDomainRE.MatchString(g) ||
		goalIPv4RE.MatchString(g) || goalLocalhostRE.MatchString(g) || goalPathRE.MatchString(g) {
		return nil
	}
	return errors.New("goal names no target: include the URL/host/IP/path under test (or the literal marker [targetless] for target-less analysis tasks) so workers cannot be dispatched against an unrelated asset")
}
