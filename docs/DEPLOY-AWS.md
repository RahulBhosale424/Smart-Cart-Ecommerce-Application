# Deploy to AWS with GitHub Actions

This is the guide behind your resume line: *"Automated testing and deployment using GitHub Actions, Docker, and AWS."*

What happens after you finish this guide:

```
 you: git push to main
        |
        v
 GitHub Actions
   1. runs the tests of all 7 services
   2. builds all the Docker images
   3. copies the code to your AWS server and runs "docker compose up -d --build"
   4. calls the live website to check that it works
        |
        v
 AWS EC2 server  ->  http://YOUR_SERVER_IP
```

> **Be honest in the interview.** The claim is only true after you have done this once.
> It takes about 1 to 2 hours the first time. Do it before your interviews, and keep the server running (or be ready to start it) so you can open the live site when asked.

## Step 1: Create the server (EC2)

1. In the AWS console open **EC2 > Launch instance**.
2. **Name:** smartcart
3. **Image:** Ubuntu Server 24.04 LTS
4. **Instance type:** `t3.medium` (4 GB RAM) is comfortable. `t3.small` (2 GB) can work because the setup script adds swap, but it is slower and tight. `t2.micro` / `t3.micro` (1 GB) are **too small**: Kafka, MongoDB and the Node services will not fit.
5. **Key pair:** create a new one (RSA, `.pem`), download it and keep it safe. You cannot download it again.
6. **Network settings:** create a security group with exactly two inbound rules:
   - SSH (port 22), source: *My IP*
   - HTTP (port 80), source: *Anywhere*

   Do **not** open any other port. The databases, Kafka and the API gateway must stay private.
7. **Storage:** 20 GB gp3.
8. Launch.

Optional but recommended: **Elastic IP** (EC2 > Elastic IPs > Allocate, then Associate with the instance). Without it the public IP changes every time you stop and start the server, and you would have to update the GitHub secret each time.

## Step 2: Install Docker on the server

From your computer (replace the path and the IP):

```bash
ssh -i /path/to/smartcart.pem ubuntu@YOUR_SERVER_IP
```

Windows: use PowerShell (`ssh` is built in) or any SSH tool.

Now on the server, run the setup script. Either copy the file `scripts/ec2-setup.sh` onto the server with `scp`:

```bash
# from your computer
scp -i /path/to/smartcart.pem scripts/ec2-setup.sh ubuntu@YOUR_SERVER_IP:~/
# then on the server
bash ~/ec2-setup.sh
```

or paste the file's content into `nano ec2-setup.sh` on the server and run `bash ec2-setup.sh`.

When it finishes, type `exit` and log in again (this activates Docker permissions). Check: `docker --version` and `docker compose version`.

## Step 3: Put your code on GitHub

If you have not yet, follow section 10 of [SETUP.md](SETUP.md). A **private** repository is fine.

## Step 4: Create the server's private `.env`

The `.env` file holds your passwords and keys, so it never goes to GitHub. You create it on the server once:

```bash
nano ~/smartcart/.env
```

Paste this and fill in your own values (letters and numbers only in the password):

```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=PUT_A_STRONG_PASSWORD
JWT_SECRET=PUT_A_LONG_RANDOM_TEXT_OF_40_PLUS_CHARACTERS
ADMIN_EMAIL=you@example.com
STRIPE_SECRET_KEY=
CURRENCY=inr
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
MIN_SIMILARITY=0.25
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=SmartCart <no-reply@smartcart.dev>
FRONTEND_PORT=80
GATEWAY_PORT=8080
RATE_LIMIT_PER_MIN=300
```

`FRONTEND_PORT=80` is what makes the site open at `http://YOUR_SERVER_IP` without a port number.
Save with `Ctrl+O`, `Enter`, `Ctrl+X`.

## Step 5: Add the secrets to GitHub

GitHub repository > **Settings > Secrets and variables > Actions > New repository secret**. Add three:

| Name | Value |
|---|---|
| `EC2_HOST` | the server's public IP (the Elastic IP if you made one) |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | open the `.pem` file in a text editor and paste **everything**, including the `-----BEGIN...` and `-----END...` lines |

## Step 6: Deploy

Push any change to `main`, or open the **Actions** tab and re-run the last workflow.

Watch it in the **Actions** tab. The jobs run in this order: `Test` (7 in parallel), `Build Docker images`, `Deploy to AWS EC2`.
The first deploy builds all images on the server and takes **10 to 15 minutes**. Later deploys are faster.

If the *Deploy* job fails at "Check that the deployment secrets exist", a secret from step 5 is missing or misspelled.

## Step 7: Add the sample products (once)

```bash
ssh -i /path/to/smartcart.pem ubuntu@YOUR_SERVER_IP \
  'cd ~/smartcart && docker compose exec -T product-service node src/seed.js'
```

## Step 8: Check that it works

- Open `http://YOUR_SERVER_IP` in a browser. Register, add to cart, place an order with both test cards.
- Run the demo script on the server (the gateway is not public, so we run it from inside the server's network):

```bash
ssh -i /path/to/smartcart.pem ubuntu@YOUR_SERVER_IP \
  'cd ~/smartcart && docker run --rm --network host -v "$PWD/scripts:/s" node:20-alpine node /s/demo.js'
```

- Look at the containers: `ssh ... 'cd ~/smartcart && docker compose ps'`

## How to explain this in an interview (simple version)

> "I push my code to GitHub. A GitHub Actions workflow starts: it runs the unit tests of all seven services in parallel, then builds every Docker image to prove they build. If that passes and the push was to the main branch, the last job connects to my AWS EC2 server over SSH, copies the new code, and runs docker compose up with the build flag, so the containers are rebuilt and restarted. Then it calls the live site as a smoke test. Secrets like the SSH key are kept in GitHub Secrets, and the passwords live only in a .env file on the server."

Questions you may get, with honest answers:

| Question | Answer |
|---|---|
| Is the deployment zero-downtime? | No. `docker compose up -d --build` replaces containers one by one, so there is a short interruption. For zero downtime I would use rolling updates (Kubernetes) or blue-green with a load balancer. |
| How do you roll back? | Re-run the workflow for the previous commit in the Actions tab. The server is rebuilt from that older code. Tagging images by commit would make it faster. |
| Where are secrets? | GitHub Secrets for the SSH key and server address, and a `.env` file on the server for application secrets. Nothing secret is in git. |
| Why EC2 and not ECS/Kubernetes? | Simplest option that really runs the full docker-compose stack. For real scale I would move to ECS or Kubernetes. |
| Is it HTTPS? | Not in this version. With a domain I would add HTTPS using a reverse proxy such as Caddy or a load balancer with a certificate. |

## Costs and cleaning up

AWS charges while resources exist. Prices change, so check the AWS pricing page. As a rough idea, a `t3.medium` costs on the order of a few cents per hour if left running all month, plus small charges for storage and for the public IPv4 address.

- Set a **billing alarm** (Billing > Budgets) before you start.
- When you are not interviewing, **stop** the instance (storage is still billed, compute is not). The Elastic IP is free while attached to a *running* instance and charged otherwise, so release it if you stop for a long time.
- When you are completely done: **terminate** the instance and release the Elastic IP.

## If something goes wrong

| Problem | Fix |
|---|---|
| `Permission denied (publickey)` in the Deploy job | `EC2_SSH_KEY` is wrong or incomplete, or `EC2_USER` is not `ubuntu` |
| Deploy job: `docker: command not found` or permission denied | you did not log out and in after step 2, or the setup script did not finish |
| Site not reachable | the security group must allow port 80 from anywhere, and `FRONTEND_PORT=80` must be in the server's `.env` |
| Containers keep restarting | the server is out of memory. Use `t3.medium`, then check `docker compose logs <service>` on the server |
| Smoke test fails but the site opens later | the first start is slow (Kafka). Re-run the job |
| Check the server's memory | `free -h` and `docker stats --no-stream` |
