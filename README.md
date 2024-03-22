<div align='center'>
    <br/>
    <br/>
    <h3>migrate-planetscale-to-supabase</h3>
    <p>**I found all the pgloader options so you don't have to**</p>
    <br/>
    <br/>

</div>

What this project does:

1. Takes your Mysql and Postgres connection strings
1. Calls pgloader via Docker to migrate your schema and data
1. There are some magic options required to do so:
    - add `useSSL=true` to your Mysql connection string
    - add `--no-ssl-cert-verification` to pgloader to not fail with `X509_V_ERR_SELF_SIGNED_CERT_IN_CHAIN`
    - add `quote identifiers` to not make all table names lowercase
    - renames the created schema from your Mysql database name to `public` in Postgres
    - Enable row level security on all tables to prevent making them accessible to everyone

## Usage

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

## Limitations:

-   If you use Prisma your enums will be renamed with kebab case, this is because Mysql doesn't give names to enums
