// Fetch pinned upstream source with Go's signed checksum database verification.
// This helper runs only in the source-acquisition build stage.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const module = "github.com/Autumn-27/artex"
const version = "v0.3.15"
const expectedSum = "h1:maolFfGTu2/JCOSR1Lua75lNdA/DC9nfAYKonsmc/wE="
const expectedModSum = "h1:co3w1e4uo1uPJWi+2Eyinpuqutk54GofVoGvIFuZTIc="

func acquire(destination string) error {
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		return fmt.Errorf("destination must not exist")
	}
	command := exec.Command("go", "mod", "download", "-json", module+"@"+version)
	// Reject environment overrides that could bypass the public checksum database.
	blocked := map[string]bool{"GOPROXY": true, "GOSUMDB": true, "GONOSUMDB": true, "GONOPROXY": true, "GOPRIVATE": true, "GOINSECURE": true, "GOENV": true, "GOWORK": true, "GOTOOLCHAIN": true}
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if !blocked[key] { command.Env = append(command.Env, entry) }
	}
	command.Env = append(command.Env, "GOPROXY=https://proxy.golang.org", "GOSUMDB=sum.golang.org", "GONOSUMDB=", "GONOPROXY=", "GOPRIVATE=", "GOINSECURE=", "GOENV=off", "GOWORK=off", "GOTOOLCHAIN=local")
	body, err := command.Output()
	if err != nil { return fmt.Errorf("verified upstream download failed") }
	var result struct { Path, Version, Sum, GoModSum, Dir, Error string }
	if err := json.Unmarshal(body, &result); err != nil { return fmt.Errorf("invalid Go download metadata: %w", err) }
	if result.Error != "" || result.Path != module || result.Version != version || result.Sum != expectedSum || result.GoModSum != expectedModSum || !filepath.IsAbs(result.Dir) {
		return fmt.Errorf("upstream identity or pinned checksum mismatch")
	}
	count := 0
	var size int64
	err = filepath.WalkDir(result.Dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil { return err }
		rel, err := filepath.Rel(result.Dir, path)
		if err != nil || !filepath.IsLocal(rel) { return fmt.Errorf("unsafe upstream path") }
		target := filepath.Join(destination, rel)
		if entry.IsDir() { return os.MkdirAll(target, 0755) }
		if entry.Type() & os.ModeSymlink != 0 { return fmt.Errorf("upstream symlink rejected") }
		info, err := entry.Info()
		if err != nil { return err }
		if !info.Mode().IsRegular() { return fmt.Errorf("nonregular upstream file rejected") }
		count++
		size += info.Size()
		if count > 10000 || size > 256<<20 { return fmt.Errorf("upstream source exceeds acquisition limits") }
		input, err := os.Open(path)
		if err != nil { return err }
		defer input.Close()
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644 | (info.Mode().Perm() & 0111))
		if err != nil { return err }
		_, copyErr := io.Copy(output, input)
		closeErr := output.Close()
		if copyErr != nil { return copyErr }
		return closeErr
	})
	if err != nil { return err }
	fmt.Printf("Verified %s@%s %s (%d files)\n", module, version, expectedSum, count)
	return nil
}

func main() {
	if len(os.Args) != 2 { fmt.Fprintln(os.Stderr, "usage: fetch-source <new-directory>"); os.Exit(2) }
	if err := acquire(os.Args[1]); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
}
