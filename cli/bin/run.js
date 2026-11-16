#!/usr/bin/env bun
/**
 * The openlab CLI entry point.
 *
 * Bun runs the TypeScript commands directly — oclif v5 detects the bun runtime and skips
 * its ts-node dance — so there is no build step between editing a command and running it.
 */
import { execute } from '@oclif/core'

await execute({ dir: import.meta.url })
