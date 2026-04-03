---
name: google-drive
description: Access Google Drive — list files, search, read documents, upload, create folders, share, and move files. Use when the user asks about files in Drive, wants to save something to Drive, or references a Drive link.
---

# Google Drive

Access the user's Google Drive via the `gdrive.mjs` script.

## Quick reference

```bash
GDRIVE="/home/node/.claude/skills/google-drive/gdrive.mjs"

node $GDRIVE list                              # List root folder
node $GDRIVE list <folderId>                   # List specific folder
node $GDRIVE search "quarterly report"         # Full-text search
node $GDRIVE read <fileId>                     # Read file content
node $GDRIVE info <fileId>                     # File metadata
node $GDRIVE upload /workspace/group/file.txt  # Upload file
node $GDRIVE upload file.txt <folderId>        # Upload to folder
node $GDRIVE mkdir "New Folder"                # Create folder
node $GDRIVE mkdir "Sub" <parentFolderId>      # Create subfolder
node $GDRIVE share <fileId> user@email.com     # Share as reader
node $GDRIVE share <fileId> user@email.com writer  # Share as writer
node $GDRIVE move <fileId> <newParentId>       # Move file
node $GDRIVE delete <fileId>                   # Trash file
```

## File IDs

Every file and folder in Drive has an ID shown in `[brackets]` in list/search output. You can also extract IDs from Drive URLs — the script handles both.

## Google Workspace files

Google Docs, Sheets, and Slides are automatically exported:
- **Docs** → plain text
- **Sheets** → CSV
- **Slides** → plain text

## Uploading

Upload local files (max 5MB) from the workspace. The file is created in the root folder unless a parent folder ID is given.

## Tips

- Always `list` or `search` first to find file IDs before reading
- Use `search` for full-text search across all files
- `delete` moves to trash (recoverable), not permanent delete
- Binary files (images, PDFs) are saved to `/tmp/` when read
