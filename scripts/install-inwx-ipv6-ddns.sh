#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE=/etc/inwx-ddns.netrc
UPDATER_FILE=/usr/local/sbin/inwx-ddns-update
SERVICE_FILE=/etc/systemd/system/inwx-ddns.service
TIMER_FILE=/etc/systemd/system/inwx-ddns.timer

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo: sudo bash $0" >&2
  exit 1
fi

for command in ip curl awk grep systemctl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

if [[ ! -d /run/systemd/system ]]; then
  echo "systemd is required to install and enable the periodic updater." >&2
  exit 1
fi

if ! ip -6 route get 2606:4700:4700::1111 >/dev/null 2>&1; then
  echo "No working IPv6 route found. Check the Pi's network connection." >&2
  exit 1
fi

if [[ ! -r /dev/tty ]]; then
  echo "An interactive terminal is required to enter the INWX credentials." >&2
  exit 1
fi

read -r -p "INWX DynDNS username: " INWX_USERNAME </dev/tty
if [[ -z "$INWX_USERNAME" ]]; then
  echo "The username cannot be empty." >&2
  exit 1
fi

read -r -s -p "INWX DynDNS password: " INWX_PASSWORD </dev/tty
echo
if [[ -z "$INWX_PASSWORD" ]]; then
  echo "The password cannot be empty." >&2
  exit 1
fi

escape_netrc_value() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '"%s"' "$value"
}

umask 077
{
  printf 'machine dyndns.inwx.com login '
  escape_netrc_value "$INWX_USERNAME"
  printf ' password '
  escape_netrc_value "$INWX_PASSWORD"
  printf '\n'
} >"$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
unset INWX_PASSWORD

cat >"$UPDATER_FILE" <<'UPDATER'
#!/usr/bin/env bash
set -euo pipefail

route=$(ip -6 route get 2606:4700:4700::1111)
iface=$(awk '{for (i=1; i<=NF; i++) if ($i=="dev") {print $(i+1); exit}}' <<<"$route")
if [[ -z "$iface" ]]; then
  echo "Could not determine the outbound IPv6 interface." >&2
  exit 1
fi

mapfile -t addresses < <(
  ip -o -6 addr show dev "$iface" scope global |
    awk '!/(temporary|deprecated|tentative|dadfailed)/ {
      split($4, address, "/")
      if (address[1] !~ /^(fc|fd|fe80)/) print address[1]
    }'
)

if (( ${#addresses[@]} != 1 )); then
  echo "Expected exactly one stable global IPv6 address on $iface; found ${#addresses[@]}." >&2
  ip -6 addr show dev "$iface" scope global >&2
  exit 1
fi

response=$(curl --fail --silent --show-error --basic \
  --netrc-file /etc/inwx-ddns.netrc \
  --get --data-urlencode "myipv6=${addresses[0]}" \
  'https://dyndns.inwx.com/nic/update')
case "$response" in
  good*|nochg*)
    printf '%s\n' "$response"
    ;;
  *)
    echo "INWX DynDNS update failed: $response" >&2
    exit 1
    ;;
esac
UPDATER
chmod 750 "$UPDATER_FILE"

cat >"$SERVICE_FILE" <<'SERVICE'
[Unit]
Description=Update INWX DynDNS IPv6 address
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/inwx-ddns-update
SERVICE

cat >"$TIMER_FILE" <<'TIMER'
[Unit]
Description=Periodically update INWX DynDNS IPv6 address

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now inwx-ddns.timer
systemctl start inwx-ddns.service

echo
echo "DynDNS updater installed and enabled."
echo "Latest update result:"
systemctl --no-pager --full status inwx-ddns.service
echo
echo "Timer status:"
systemctl --no-pager list-timers inwx-ddns.timer
