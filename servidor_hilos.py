import http.server
import socketserver

PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Estas son las llaves maestras que exigen los navegadores modernos
        # para permitir que el código web use múltiples hilos del procesador.
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

# Levantamos el servidor
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"🚀 Servidor Centinela corriendo en http://localhost:{PORT}")
    print("🔓 Permisos Multi-hilo DESBLOQUEADOS.")
    httpd.serve_forever()
