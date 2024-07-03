#!/usr/bin/env node

import { Client } from 'pg'

import dedent from 'dedent'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { cancel, intro, isCancel, log, outro, text } from '@clack/prompts'
import { spawn } from 'child_process'
import color from 'picocolors'

async function main() {
    console.log()

    // check that docker is installed

    try {
        await shell(`docker --version`)
        console.log('')
    } catch (e) {
        throw new Error('Docker is not installed')
    }

    intro(color.inverse(' Migrate from PlanetScale to Supabase '))

    let mysqlUrl = new URL(`mysql://user:password@localhost:3306/db`)

    // validate mysqlUrl
    if (mysqlUrl.protocol !== 'mysql:') {
        throw new Error('Invalid MySQL connection URI')
    }

    // remove all query params
    for (const key of mysqlUrl.searchParams.keys()) {
        mysqlUrl.searchParams.delete(key)
    }

    const mysqlDatabase = mysqlUrl.pathname.replace('/', '')

    const _postgresUrl = await text({
        message: 'What is your Supabase connection URI?',
        placeholder: 'postgres://',
    })
    if (isCancel(_postgresUrl)) {
        cancel('Operation cancelled')
        return process.exit(0)
    }
    let postgresUrl = new URL(_postgresUrl)

    if (postgresUrl.port === '6543') {
        postgresUrl.port = '5432'
    }
    // validate postgres url
    if (
        postgresUrl.protocol !== 'postgres:' &&
        postgresUrl.protocol !== 'postgresql:'
    ) {
        throw new Error('Invalid Postgres connection URI')
    }
    // should include pooler.supabase.com
    if (!postgresUrl.hostname?.includes('pooler.supabase.com')) {
        throw new Error(
            'Invalid Postgres connection URI, should include pooler.supabase.com',
        )
    }

    if (postgresUrl.hostname)
        // remove all other params
        for (const key of postgresUrl.searchParams.keys()) {
            postgresUrl.searchParams.delete(key)
        }

    // add sslmode=disable to make it work with pgloader
    postgresUrl.searchParams.set('sslmode', 'disable')

    const config = dedent`
    LOAD DATABASE
        FROM      ${mysqlUrl}
        INTO      ${postgresUrl}


    WITH include drop, create tables, create indexes, reset sequences, quote identifiers, 
    batch rows = 1000,
    batch size = 500 MB,
    prefetch rows = 1000


    ALTER SCHEMA '${mysqlDatabase}' RENAME TO 'public'
    ;
    `
    const tmp = path.resolve(os.tmpdir(), 'pgloader-temp')
    fs.mkdirSync(tmp, { recursive: true })
    const configPath = path.resolve(tmp, 'pgloader-config.load')

    log.info('Migrating data from PlanetScale to Supabase...')
    console.log()

    fs.writeFileSync(configPath, config, 'utf-8')
    try {
        await shell(
            `docker run --network="host" --rm --platform=linux/amd64 -v ${tmp}:/tmp/pgloader ghcr.io/dimitri/pgloader:latest pgloader --no-ssl-cert-verification /tmp/pgloader/pgloader-config.load`,
            {},
        )
    } finally {
        fs.unlinkSync(configPath)
    }

    // extract ref from postgresUrl
    let ref = ''
    try {
        ref = postgresUrl.username.split('.')[1]
    } catch (e) {
        // log.error('Could not extract ref from Postgres connection URI')
    }

    const pgClient = new Client(postgresUrl.toString())
    await pgClient.connect()

    await pgClient.query(`DO $$
    DECLARE
        r RECORD;
    BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        LOOP
            EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' ENABLE ROW LEVEL SECURITY;';
        END LOOP;
    END$$`)

    await pgClient.end()
    log.info(`Migration complete! 🎉🎉🎉`)
    outro(
        `Check your new database at https://supabase.com/dashboard/project/${ref}/editor`,
    )
}
main().catch(console.error)

export function shell(
    cmd: string,
    opts?: { cwd?: string; env?: Record<string, string> },
) {
    let stdout = '',
        stderr = '',
        combined = ''
    let onStdout = (data: any) => {
        process.stdout.write(data)
        stdout += data
        combined += data
    }
    let onStderr = (data: any) => {
        process.stderr.write(data)
        stderr += data
        combined += data
    }

    const child = spawn(cmd, {
        ...opts,
        env: { ...process.env, ...opts?.env },
        stdio: 'pipe',
        shell: true,
    })

    child.stderr.on('data', onStderr)
    child.stdout.on('data', onStdout)
    let killed = false
    function signalHandler() {
        killed = true
        child.kill()
    }
    process.on('SIGINT', signalHandler)
    process.on('SIGTERM', signalHandler)
    process.on('SIGQUIT', signalHandler)
    process.on('exit', signalHandler)
    process.on('uncaughtExceptionMonitor', (e) => {
        signalHandler()
    })

    const start = Date.now()
    return new Promise<void>((resolve, reject) => {
        // p.on('error', () => reject)
        child.on('close', (code) => {
            const end = Date.now()
            const mins = (end - start) / (1000 * 60)

            if (code === 0) {
                resolve()
            } else {
                if (killed) {
                    return
                }
                const e = new Error(
                    `Could not run '${cmd.split(' ')[0]}': code ${code}`,
                )
                reject(e)
            }
        })
    })
}
