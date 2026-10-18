# Fog Mirror

Static, browser-only MVP derived from the interaction patterns in Aurora Air Canvas.

Serve the `outputs` directory so the page is available at `/play/fog-mirror/`:

```bash
python3 -m http.server 4173 --directory outputs
```

Camera access requires HTTPS in production (or `localhost` during development). Images are composed and downloaded locally; the page has no backend, analytics, storage, or upload path.
