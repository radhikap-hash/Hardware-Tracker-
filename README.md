# Hardware Tracker

Live PCB design status tracker for VConnecTech. The Google Sheet is the database;
the dashboard and the entry form are Apps Script faces on it.

- **See the design:** https://radhikap-hash.github.io/Hardware-Tracker-/ — a static
  snapshot of the dashboard with real board data baked in. Everything works except
  saving, which needs the deployed script.
- **The live dashboard** is the Apps Script `/exec` URL, not this repo. GitHub is
  where the code is stored and versioned; it is never in the path between the sheet
  and a viewer's browser.

## Layout

```
index.html            static preview, served by GitHub Pages
apps-script/
  Code.gs             backend: reads and writes the sheet, routes boards, respins
  Dashboard.html      the dashboard (CSS and form JS inlined — no include() calls)
  BoardForm.html      the popup form shown inside Google Sheets
  appsscript.json     manifest
```

Three files go in the Apps Script editor: `Code.gs`, `Dashboard`, `BoardForm`.
There is no `Styles` or `FormBody` any more — both are inlined, so there is nothing
left to mis-name.

## Syncing with Apps Script

`git push` does **not** update the `/exec` URL. Only clasp moves code into Apps
Script, and even that does not redeploy.

```bash
npm install -g @google/clasp
clasp login
echo '{"scriptId":"YOUR_SCRIPT_ID","rootDir":"apps-script"}' > .clasp.json
clasp push
```

Script ID is in the Apps Script editor under Project Settings. After `clasp push`,
redeploy: **Deploy → Manage deployments → pencil → Version: New version → Deploy**.

## Sheet contract

The script finds its columns by reading the header rows, so columns can move. What
it needs is that the field header row still contains a cell reading `Project / Board`,
and that each stage block keeps its group header (`S1 SCHEMATIC`, `S2 BOM PROCUREMENT`,
and so on) in the row above.
