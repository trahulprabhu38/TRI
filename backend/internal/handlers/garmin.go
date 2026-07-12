package handlers

import (
	"archive/zip"
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// GarminStatus reports whether the user has uploaded their own Garmin export.
func (h *Handler) GarminStatus(c *gin.Context) {
	dir := Users.GarminDir(c.GetString("uid"))
	n := countJSON(dir)
	c.JSON(http.StatusOK, gin.H{
		"hasData":     n > 0,
		"fileCount":   n,
		"usingSample": n == 0,
	})
}

// GarminUpload accepts a Garmin export as a .zip and/or individual/folder .json
// files, extracts every JSON into the user's Garmin directory, and refreshes their store.
func (h *Handler) GarminUpload(c *gin.Context) {
	sub := c.GetString("uid")
	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "expected a multipart upload"})
		return
	}

	// Collect every uploaded file across all form fields.
	var files []*multipart.FileHeader
	for _, fs := range form.File {
		files = append(files, fs...)
	}
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no files uploaded"})
		return
	}

	dir := Users.GarminDir(sub)
	imported, zips := 0, 0
	for _, fh := range files {
		name := strings.ToLower(fh.Filename)
		switch {
		case strings.HasSuffix(name, ".zip"):
			n, err := extractZipJSON(fh, dir)
			if err == nil {
				imported += n
				zips++
			}
		case strings.HasSuffix(name, ".json"):
			if saveUploadedFile(fh, filepath.Join(dir, filepath.Base(fh.Filename))) == nil {
				imported++
			}
		}
	}

	if imported == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no JSON files found in the upload"})
		return
	}

	h.reloadUser(sub)
	c.JSON(http.StatusOK, gin.H{
		"imported":   imported,
		"zips":       zips,
		"totalFiles": countJSON(dir),
	})
}

// GarminClear removes the user's uploaded Garmin data (reverting to the sample).
func (h *Handler) GarminClear(c *gin.Context) {
	sub := c.GetString("uid")
	dir := Users.GarminDir(sub)
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
	h.reloadUser(sub)
	c.JSON(http.StatusOK, gin.H{"status": "cleared"})
}

// extractZipJSON writes every .json entry in the zip (flattened) into dir.
func extractZipJSON(fh *multipart.FileHeader, dir string) (int, error) {
	f, err := fh.Open()
	if err != nil {
		return 0, err
	}
	defer f.Close()
	buf, err := io.ReadAll(f)
	if err != nil {
		return 0, err
	}
	zr, err := zip.NewReader(bytes.NewReader(buf), int64(len(buf)))
	if err != nil {
		return 0, err
	}
	n := 0
	for _, ze := range zr.File {
		if ze.FileInfo().IsDir() || !strings.HasSuffix(strings.ToLower(ze.Name), ".json") {
			continue
		}
		rc, err := ze.Open()
		if err != nil {
			continue
		}
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}
		if os.WriteFile(filepath.Join(dir, filepath.Base(ze.Name)), content, 0o644) == nil {
			n++
		}
	}
	return n, nil
}

func saveUploadedFile(fh *multipart.FileHeader, dest string) error {
	src, err := fh.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, src)
	return err
}
