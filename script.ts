import { $ } from 'bun'
import fs from 'fs'

let mysqlUrl = new URL(``)

// add ?useSSL=true to make it work with planetscale
mysqlUrl.searchParams.set('useSSL', 'true')

const mysqlDatabase = mysqlUrl.pathname.replace('/', '')

const postgresUrl = ``

const config = `
LOAD DATABASE
     FROM      ${mysqlUrl}
     INTO     ${postgresUrl}

WITH include drop, create tables, create indexes, reset sequences, quote identifiers,

ALTER SCHEMA '${mysqlDatabase}' RENAME TO 'public'
`

await $`echo ${config} | docker run --rm -it --platform=linux/amd64 ghcr.io/pgloader:latest pgloader`
