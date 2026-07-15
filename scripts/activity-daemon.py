import subprocess
import time
import urllib.request
import json
from urllib.parse import urlparse


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


def run_applescript(script):
    try:
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=1)
    except Exception:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def extract_domain(url):
    if not url:
        return None
    parsed = urlparse(url)
    host = parsed.hostname
    if not host and "://" not in url:
        host = urlparse(f"https://{url}").hostname
    if not host:
        return None
    return host.lower().removeprefix("www.")


def get_browser_url(app):
    scripts = {
        "Safari": 'tell application "Safari" to get URL of current tab of front window',
        "Google Chrome": 'tell application "Google Chrome" to get URL of active tab of front window',
        "Arc": 'tell application "Arc" to get URL of active tab of front window',
        "Brave Browser": 'tell application "Brave Browser" to get URL of active tab of front window',
    }
    script = scripts.get(app)
    if not script:
        return None, None
    full_url = run_applescript(script)
    return extract_domain(full_url), full_url or None


while True:
    try:
        app, window = get_active_window_title()
        if app:
            domain, full_url = get_browser_url(app)
            data = json.dumps({
                "app": app,
                "window": window,
                "url": domain,
                "full_url": full_url,
            }).encode()
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
