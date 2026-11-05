#!/bin/sh
# Prints what a server's Bun makes of dates, to compare dev with production.
# Run from the rook directory: sh scripts/check-dates.sh
# Expected on a healthy box: the last line ends "2026-11-03T16:01:37.174Z | Nov 3, 2026 at 10:01 AM"

echo "bun version:   $(bun --version)"
echo "commit:        $(git log --oneline -1)"
echo "shell date:    $(date)"
echo "TZ variable:   ${TZ:-(unset)}"
echo "localtime:     $(ls -l /etc/localtime 2>/dev/null)"
echo "saved zone:    $(sqlite3 -readonly data/rook.db "select value from userSettings where key='timeZone'" 2>/dev/null)"
bun -e "console.log('bun zone:     ', Intl.DateTimeFormat().resolvedOptions().timeZone)"
bun -e "const d=new Date(1793721697174); console.log('sample:       ', d.toISOString(), '|', d.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Chicago'}))"
