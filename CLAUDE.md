# CLAUDE.md - my-project

> **Documentation Version**: 1.0
> **Last Updated**: 2026-02-06
> **Project**: my-project
> **Description**: CLI tool
> **Features**: GitHub auto-backup, Task agents, technical debt prevention

This file provides essential guidance to Claude Code (claude.ai/code) when working with code in this repository.

## CRITICAL RULES - READ FIRST

### ABSOLUTE PROHIBITIONS
- **NEVER** create new files in root directory - use proper module structure
- **NEVER** write output files directly to root directory - use designated output folders
- **NEVER** create documentation files (.md) unless explicitly requested by user
- **NEVER** use git commands with -i flag (interactive mode not supported)
- **NEVER** use `find`, `grep`, `cat`, `head`, `tail`, `ls` commands - use Read, Grep, Glob tools instead
- **NEVER** create duplicate files (manager_v2.js, enhanced_xyz.js, utils_new.js) - ALWAYS extend existing files
- **NEVER** create multiple implementations of same concept - single source of truth
- **NEVER** copy-paste code blocks - extract into shared utilities/functions
- **NEVER** hardcode values that should be configurable - use config files/environment variables
- **NEVER** use naming like enhanced_, improved_, new_, v2_ - extend original files instead

### MANDATORY REQUIREMENTS
- **COMMIT** after every completed task/phase - no exceptions
- **GITHUB BACKUP** - Push to GitHub after every commit: `git push origin main`
- **USE TASK AGENTS** for all long-running operations (>30 seconds)
- **READ FILES FIRST** before editing - Edit/Write tools will fail if you didn't read the file first
- **DEBT PREVENTION** - Before creating new files, check for existing similar functionality to extend
- **SINGLE SOURCE OF TRUTH** - One authoritative implementation per feature/concept

### EXECUTION PATTERNS
- **PARALLEL TASK AGENTS** - Launch multiple Task agents simultaneously for maximum efficiency
- **GITHUB BACKUP WORKFLOW** - After every commit: `git push origin main`
- **BACKGROUND PROCESSING** - ONLY Task agents can run true background operations

### MANDATORY PRE-TASK COMPLIANCE CHECK

Before starting any task, verify:
- [ ] Will this create files in root? If YES, use proper module structure instead
- [ ] Will this take >30 seconds? If YES, use Task agents not Bash
- [ ] Does similar functionality already exist? If YES, extend existing code
- [ ] Am I creating a duplicate class/manager? If YES, consolidate instead
- [ ] Have I searched for existing implementations? Use Grep/Glob tools first
- [ ] Can I extend existing code instead of creating new? Prefer extension over creation

## PROJECT OVERVIEW

**my-project** is a CLI tool built with JavaScript.

### Project Structure
```
src/main/js/          # Main JavaScript source code
  core/               # Core business logic
  utils/              # Utility functions
  models/             # Data models
  services/           # Service layer
  api/                # API interfaces
src/main/resources/   # Configuration and assets
src/test/             # Unit and integration tests
docs/                 # Documentation
tools/                # Development tools
output/               # Generated output files
```

### Development Status
- **Setup**: Complete
- **Core Features**: Not started
- **Testing**: Not started
- **Documentation**: Not started

## TECHNICAL DEBT PREVENTION

### CORRECT APPROACH:
```bash
# 1. SEARCH FIRST
Grep(pattern="feature.*implementation", include="*.js")
# 2. READ EXISTING FILES
Read(file_path="existing_feature.js")
# 3. EXTEND EXISTING FUNCTIONALITY
Edit(file_path="existing_feature.js", old_string="...", new_string="...")
```

## COMMON COMMANDS

```bash
# Run the CLI tool
node src/main/js/index.js

# Run tests
npm test

# Check git status
git status

# Push to GitHub
git push origin main
```
