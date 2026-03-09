# Base Skill Tools Reference

Tool parameters and usage. Load when you need exact parameter names or examples.

## read

Read file contents. Path is relative to current working directory or absolute.

- **path** (required): File path.

## bash

Execute a shell command. Use for ls, grep, find, running scripts.

- **command** (required): Shell command string.

## edit

Replace exact text in a file. The `oldText` must match file content exactly (including whitespace).

- **path** (required): File path.
- **oldText** (required): Exact text to replace.
- **newText** (required): Replacement text.

## write

Create or overwrite a file with full content. Use only for new files or complete rewrites.

- **path** (required): File path.
- **content** (required): Full file content.
