# FY-26 Dashboard

An interactive performance dashboard with edit/view modes. Upload your own Excel data to recalculate every widget.

## Run locally
Serve the folder over http (file:// won't fetch the bundled xlsx):

```
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Deploy to GitHub Pages
1. Push this folder to a GitHub repo.
2. Settings → Pages → Source: `main` branch, root.
3. Visit `https://<username>.github.io/<repo>/`.

## Expected column headers (for new uploads)
`Brand`, `Article Type`, `Style id`, `Total Sales Qty`, `Total Return Qty`, `GMV`, `Revenue`, `Inventory`, `Active Days`
