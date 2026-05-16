## Words

- **component**: like textarea,table,form
- **component-editor**: define components in screen as json
- **schema-editor**: a screen defineed by json. crud json schema of compoonent,screen or others. it may edit data also, not only schema

## System structure

- using cloudflare worker. basically no static assets
- system has front,identify,authorize,execute
- front has web, mcp, api(future). workers are `front` and `front-dev`, and developed in localhost.
- json is in R2
- worker uses R2 via 'authorize' worker which is service binded, not on internet
- Probably bypass authorize when developing in localhost

## Identify

1. start `/oauth/github/start` in front
2. generate identify url at `/github/oauth/start` in identify
3. identify in github
4. callback at `/github/oauth/callback` in front
5. exchange code, save session in identify and redirect to front

# Secrets

- all secrets are in cloudflare secrets store
- secrets for dev envirinment should have suffix of `_DEV`
- values are at `../secrets.json` on local

## Goals

- create dom from json without html
- generate various front from json
- edit screen layout in **component-editor**
- edit schema of each components, screens or others in **schema-editor**
- define schema,screens,component and domain words and define all of front state in editor

## Constrains

- Local dev goes through `authorize-local` and the same R2 API path as deployed environments
- Define initial value of components in script
- no legacy code for compatibility

## Quality

- File tree expresses whole structure
- Folder should express concept
- Less definition in ts, more definition in json
- Include all files in git commit　if the files is not related with changes in this time

## Hint

- Use api to create, edit, delete json
- Basically local dev server runs in other terminal
- local layouts data is still available through the configured R2 bucket
- secrets_store_secrets is not string. use `.get()` to get secret value
