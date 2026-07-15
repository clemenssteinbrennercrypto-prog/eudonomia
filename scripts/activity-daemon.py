import subprocess
import time
import urllib.request
import json


def get_active_app():
    script = 'tell application "System Events" to get name of first process whose frontmost is true'
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    return result.stdout.strip()


def get_active_window_title():
    script = """
    tell application "System Events"
        set frontApp to first process whose frontmost is true
        set appName to name of frontApp
        try
            set windowTitle to name of first window of frontApp
        on error
            set windowTitle to ""
        end try
        return appName & "|" & windowTitle
    end tell
    """
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    parts = result.stdout.strip().split("|")
    return parts[0] if parts else "", parts[1] if len(parts) > 1 else ""


while True:
    try:
        app, window = get_active_window_title()
        if app:
            data = json.dumps({"app": app, "window": window}).encode()
            req = urllib.request.Request(
                "http://localhost:7331/activity",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=1)
    except Exception:
        pass
    time.sleep(3)
