from http.server import HTTPServer, BaseHTTPRequestHandler
import json


last_activity = {"app": None, "window": None, "url": None, "full_url": None}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_POST(self):
        global last_activity
        if self.path == "/activity":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                data = json.loads(body or b"{}")
                last_activity = {
                    "app": data.get("app"),
                    "window": data.get("window"),
                    "url": data.get("url"),
                    "full_url": data.get("full_url"),
                }
            except Exception:
                pass

        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(last_activity).encode())
            return

        self.send_response(404)
        self.send_cors_headers()
        self.end_headers()


HTTPServer(("localhost", 7331), Handler).serve_forever()
