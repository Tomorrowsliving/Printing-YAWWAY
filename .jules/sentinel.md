## 2024-05-16 - Path Traversal Vulnerability with `startswith`
**Vulnerability:** Path Traversal via string prefix check bypass. In `backend/routers/files.py`, `os.path.abspath(path).startswith(os.path.abspath(STORAGE_ROOT))` was used to verify that a file operation stayed within `STORAGE_ROOT`.
**Learning:** `startswith` is insecure for path boundary validation because a sibling directory named similarly to the target directory (e.g. `printers-fake`) satisfies the `startswith` condition for `printers`.
**Prevention:** Use `os.path.commonpath([abs_path, abs_root]) == abs_root` to verify directory hierarchy containment securely.

## 2024-05-16 - Command/Argument Injection via String Prefix
**Vulnerability:** Command Injection potential in `node-agent/main.py`. Service names were validated by checking if they started with `klipper-` or `moonraker-`, allowing a malicious input like `klipper-foo; id` to bypass validation.
**Learning:** Checking string prefixes for inputs that will be passed into sensitive contexts (like systemd service names in `subprocess.run()`) fails to validate the remainder of the input, opening up command or flag injection.
**Prevention:** Use strict regex patterns such as `re.match(r'^(klipper|moonraker)-[a-zA-Z0-9_-]+$', service)` to restrict input strictly to known safe characters.

## 2024-05-17 - Path Traversal Vulnerability via File Endpoints
**Vulnerability:** Path Traversal via lack of boundary checks. In `backend/routers/files.py`, endpoints such as `list_files` and `upload_file` constructed paths using user input (`printer_slug`, `file_type`, and `file.filename`) without validating that the resulting path stayed within the intended `STORAGE_ROOT`.
**Learning:** Constructing file paths from user inputs without verifying the absolute, resolved path allows attackers to use `../` sequences to read, list, or overwrite arbitrary files on the filesystem.
**Prevention:** Construct the final absolute path using `os.path.abspath(os.path.join(...))`, resolve the intended base directory using `os.path.abspath(STORAGE_ROOT)`, and verify containment using `os.path.commonpath([abs_path, abs_root]) == abs_root`.

## 2024-05-17 - File Upload Edge Cases
**Vulnerability:** In file upload functionality, `os.path.join(target_dir, file.filename)` can be abused if `file.filename` is an absolute path. In Python, `os.path.join` discards the preceding path components if it encounters an absolute path. Also, allowing `os.makedirs` to run on a path before validating it can allow arbitrary empty directory creation on the host system.
**Learning:** Always sanitize filenames provided by users (e.g., using `os.path.basename()`) to strip out any path information. Always validate a directory path (using `os.path.commonpath`) *before* calling `os.makedirs` on it.
**Prevention:** Sanitize the uploaded filename with `os.path.basename()`. Validate `target_dir` before creating the directory, and then validate the final `file_path` as an extra measure.
