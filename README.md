<div align='center'>
    <br/>
    <br/>
    <h3>migrate-planetscale-to-supabase</h3>
    <p>I found all the pgloader options so you don't have to</p>
    <br/>
    <br/>

</div>

What this project does:

1. Dump your Planetscale database to a folder locally
1. Runs a local Mysql database seeded with your dump
1. Migrates your Mysql database to a Supabase Postgres database with Pgloader
1. Calls pgloader via Docker to migrate your schema and data, there are some magic options required to do so:
    - add `useSSL=true` to your Mysql connection string
    - add `--no-ssl-cert-verification` to pgloader to not fail with `X509_V_ERR_SELF_SIGNED_CERT_IN_CHAIN`
    - add `quote identifiers` to not make all table names lowercase
    - renames the created schema from your Mysql database name to `public` in Postgres
    - Enable row level security on all tables to prevent making them accessible to everyone

## Why not use pgloader directly on the repote Mysql database?

Because Planetscale doesn't let you fetch more than 100000 rows at a time, throwing the error `Row count exceeded 100000`

## Usage

1. Download this repository locally and cd inside it

1. Dump your Planetscale database to a folder locally with

    ```
    pscale database --org org dump database branch --output ./dump
    ```

1. Run a local Mysql database seeded with your dump with

    ```sh
    # must be inside this repository folder
    docker compose up
    ```

    > If from some reason you need to recreate the Mysql database, you can do so with `docker compose down -v`, This will recreate the database with the dump

1. Run the migration with

    ```sh
    npx migrate-planetscale-to-supabase
    ```

## If you use Prisma

After completing the migration run

```diff
datasource db {
+    provider     = "postgresql"
-    provider     = "mysql"
}
```

And pull the changes made by the migration

```sh
prisma db pull
```

Then check that your current code compiles and runs as expected

## How to migrate branches?

You can create a different Supabase project for each branch. Supabase has alpha branching support, but i would advise against using it now as it currently depends on a Github App integration.

## Limitations:

-   If you use Prisma, your enums and indexes will be renamed with kebab case, this is because Mysql doesn't give names to enums
