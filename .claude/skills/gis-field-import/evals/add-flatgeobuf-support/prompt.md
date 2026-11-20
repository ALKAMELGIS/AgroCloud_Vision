---
tags: [skill-creator]
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Our agronomists started getting field boundaries as FlatGeobuf (.fgb) files from the county, usually in EPSG:2263 or UTM. Make Upload file in the workspace accept .fgb and import every polygon as a field like the other formats.
