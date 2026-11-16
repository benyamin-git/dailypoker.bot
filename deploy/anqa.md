# Anqa deployment

The bot runs as the `dailypoker` bot under Anqa at `/srv/stacks/anqa` on this host.

- `Dockerfile` builds a Bun 1.4.2 image and runs as UID/GID `1000:1000`.
- `bot.toml` mounts the named volume `anqa-dailypoker-data` at `/data`; `DB_PATH`
  must point to `/data/dailypoker.db`.
- Keep the runtime `.env` at mode `0600`; Anqa reads it at every scan and passes
  it to the container. It is excluded from the build context.
- The old `dailypoker.service` systemd unit is disabled after cutover.

This host reaches Telegram through Kumiho. Kumiho's HTTP proxy listens on
`127.0.0.1:8080`; the `kumiho-proxy-relay.socket` user unit exposes it on
`172.17.0.1:8081` for the Docker bridge. The bot's `.env` sets
`HTTPS_PROXY=http://172.17.0.1:8081`.

To update the bot, copy the changed source and deployment files into the Anqa
bot directory, keep its `.env`, then press **Start** in Anqa. Anqa rebuilds the
image on every Start; the named volume is not recreated.

To roll back to systemd, stop the Anqa bot before starting `dailypoker.service`.
The systemd service uses the original `data/dailypoker.db`, not the Anqa volume;
copy the current Anqa database back first if the two have diverged.
