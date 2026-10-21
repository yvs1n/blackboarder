#!/usr/bin/env bash
# Updates Blackboarder now and turns on automatic updates. Run it once; your data is kept.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/updater/blackboarder-updater.sh" --install
