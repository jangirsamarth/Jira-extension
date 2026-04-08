# Jira Smart Composer Extension

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension` folder

## Use

1. Keep backend running at `http://localhost:4000`
2. Open the page you want to capture
3. Open extension popup
4. Click **Capture Screenshot**
5. Fill raw description and choose:
   - issue type (Story/Task/Bug/Epic)
   - epic handling (none/existing/new)
6. Click **Create in Jira**

The extension calls:
- `GET /api/jira/projects`
- `GET /api/jira/epics`
- `POST /api/jira/quick-create`
