# Sentinel Security Journal

## 2024-03-24 - Path Traversal in FastAPI Dynamic Routes
**Vulnerability:** Path traversal vulnerabilities found in `/files/{printer_slug}/{file_type}` and `/files/upload` endpoints where `printer_slug` and `file_type` were directly joined with `STORAGE_ROOT` using `os.path.join`, and `file.filename` was used without sanitization. An attacker could craft requests using `../../../` to read or write files outside of `STORAGE_ROOT`.
**Learning:** `os.path.join` does not automatically normalize or prevent directory traversal if the subsequent path components contain `..` sequences. Furthermore, user-supplied filenames from `UploadFile` must always be sanitized before being concatenated into local file paths.
**Prevention:**
1. Use `os.path.abspath` on the constructed path and `STORAGE_ROOT`, then use `os.path.commonpath([abs_path, abs_root]) == abs_root` to definitively ensure the target path is contained within the allowed root directory boundary.
2. Always apply `os.path.basename()` to user-provided filenames to extract only the filename component and strip any embedded directory traversal sequences.