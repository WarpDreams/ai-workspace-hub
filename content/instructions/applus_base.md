# User Instructions

## Workspace and environments

You are in Australian Payments Plus workspace. 

Atlassian instance: https://auspayplus.atlassian.net/


## reading online documents

Use Atlassian MCP when the user provides URLs that look like a Jira link or a Confluence link; for other generic web links, just use your own web/www tool.

For the reading of web documents (Confluence, or otherwise), if the amount of documents is large, you can save these documents to the local `./cache` directory of the directory you are currently launched from (create one if none available), or `/tmp` folder (ask user for preferences if you can't decide), as Markdown or HTML format as cache (whichever you seem fit), so that you can process in the subsequent steps.

## Using Atlassian REST API

To access Atlassian resources, always try the Atlassian MCP first. However, the Atlassian MCP has limits, and for some occassions, connecting to Atlassian REST API using curl or scripts might be a better idea. Should you choose to do so, all Atlassian credentials are in `~/.atlassian`. Load them as environment variables rather than pasting values into commands:

```bash
set -a; source ~/.atlassian; set +a
curl -sS -u "$ATLASSIAN_EMAIL:$ATLASSIAN_API_TOKEN" ...
```

That file provides `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN` for REST basic auth, and `ROVO_TOKEN` for Rovo. Never echo these values into terminal output, commit them, or include them in a summary.

## Local tool alternatives

Should you encounter any sandbox restrictions regarding calling local tools, if the restricted local tool is one of the following:

git
mmdc

You are allowed to use tmux session `agent-exec` to execute your call. If this tmux session does not exist, you are authorised to create one.

When sending a command to the session, wait for it to finish before reading the output, and read back from the same session you sent it to:

```bash
tmux has-session -t agent-exec || tmux new-session -d -s agent-exec
tmux send-keys -t agent-exec -l '<command>; printf "EXIT:%s\n" $?; tmux wait-for -S agent_done'
tmux send-keys -t agent-exec C-m
tmux wait-for agent_done
tmux capture-pane -p -t agent-exec -S -100
```

Use a distinct `wait-for` channel name per command when you issue several in sequence.

### mmdc specifics

`mmdc` (Mermaid CLI) drives Chromium through Puppeteer. Two things to know:

- Under sandbox restrictions Chromium may fail to create a MachPort and the render fails. This is the main reason to route `mmdc` through the tmux session above.
- `mmdc` can exit with status 0 and still produce a bad image: a blank or tiny PNG, or one containing Mermaid's "Syntax error in text" message. A zero exit status is not proof of a good render. Always open the generated image and inspect it before accepting the result.

## Using Local AWS CLI

You are allowed to call the AWS CLI to perform work the user requests. Use the profile whose permissions match the task:

- `applus_genai_nonprod` is the standard SSO source profile for AWS account `211125529707`. It signs in as the IAM Identity Center role `ApplusGenAIDeveloper`.
- `manual_aws_bedrock_full_access` is a chained profile for Amazon Bedrock work that requires full access. It uses `applus_genai_nonprod` as its source and assumes `arn:aws:iam::211125529707:role/manual_aws_bedrock_full_access`, which has the AWS-managed `AmazonBedrockFullAccess` policy attached. The role trust policy restricts assumption to Jian Shen's SSO session.

If the SSO session is expired, you are allowed to renew it with:

```bash
aws sso login --profile applus_genai_nonprod
```

Use the chained profile directly for Bedrock commands; the AWS CLI performs `sts:AssumeRole` automatically:

```bash
aws bedrock list-foundation-models --profile manual_aws_bedrock_full_access --region ap-southeast-2
```

Before making AWS changes, verify the active identity with the appropriate profile:

```bash
aws sts get-caller-identity --profile applus_genai_nonprod
aws sts get-caller-identity --profile manual_aws_bedrock_full_access
```

Both profiles use the combined AP+ Netskope and public CA bundle at `~/.aws/applus-ca-bundle.pem`. Keep SSL verification enabled; do not use `--no-verify-ssl`.

