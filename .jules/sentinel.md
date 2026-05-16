## 2024-05-16 - Path Traversal Vulnerability with `startswith`
**Vulnerability:** Path Traversal via string prefix check bypass. In `backend/routers/files.py`, `os.path.abspath(path).startswith(os.path.abspath(STORAGE_ROOT))` was used to verify that a file operation stayed within `STORAGE_ROOT`.
**Learning:** `startswith` is insecure for path boundary validation because a sibling directory named similarly to the target directory (e.g. `printers-fake`) satisfies the `startswith` condition for `printers`.
**Prevention:** Use `os.path.commonpath([abs_path, abs_root]) == abs_root` to verify directory hierarchy containment securely.

## 2024-05-16 - Command/Argument Injection via String Prefix
**Vulnerability:** Command Injection potential in `node-agent/main.py`. Service names were validated by checking if they started with `klipper-` or `moonraker-`, allowing a malicious input like `klipper-foo; id` to bypass validation.
**Learning:** Checking string prefixes for inputs that will be passed into sensitive contexts (like systemd service names in `subprocess.run()`) fails to validate the remainder of the input, opening up command or flag injection.
**Prevention:** Use strict regex patterns such as `re.match(r'^(klipper|moonraker)-[a-zA-Z0-9_-]+$', service)` to restrict input strictly to known safe characters.
