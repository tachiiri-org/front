## Words

- **component**: like textarea,table,form
- **component-editor**: define components in screen as json
- **schema-editor**: a screen defineed by json. crud json schema of compoonent,screen or others. it may edit data also, not only schema

## System structure

- using cloudflare worker. basically no static assets
- json is in R2
- worker uses R2 via 'authorize' worker which is service binded, not on internet
- Probably bypass authorize when developing in localhost

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
