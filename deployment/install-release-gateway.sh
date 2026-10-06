#!/bin/bash
# One-time operator setup, run with the existing trusted administrative connection.
set -euo pipefail
test "$(id -u)" = 0
gateway=${1:?Path to reviewed release_gateway.py}
public_key=${2:?Path to dedicated Actions public key}
test -r "$gateway" && test -s "$public_key"
command -v python3 >/dev/null
command -v visudo >/dev/null
if ! id tripdock-deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/sh tripdock-deploy
fi
# No Docker group, general sudo, or application-secret access is granted.
install -d -o root -g root -m 755 /usr/local/lib/tripdock
install -o root -g root -m 644 "$gateway" /usr/local/lib/tripdock/release_gateway.py
install -d -o root -g root -m 700 /srv/tripdock-releases
install -d -o root -g root -m 755 /var/lib/tripdock-deploy
install -d -o tripdock-deploy -g tripdock-deploy -m 700 /var/lib/tripdock-deploy/uploads
touch /var/lib/tripdock-deploy/upload.lock
chown root:tripdock-deploy /var/lib/tripdock-deploy/upload.lock
chmod 660 /var/lib/tripdock-deploy/upload.lock
cat > /usr/local/sbin/tripdock-release <<'HELPER'
#!/bin/sh
exec /usr/bin/python3 -I /usr/local/lib/tripdock/release_gateway.py promote "$@"
HELPER
chown root:root /usr/local/sbin/tripdock-release
chmod 755 /usr/local/sbin/tripdock-release
sudo_rule=$(mktemp)
trap 'rm -f "$sudo_rule"' EXIT
printf '%s\n' 'tripdock-deploy ALL=(root) NOPASSWD: /usr/local/sbin/tripdock-release' > "$sudo_rule"
visudo -cf "$sudo_rule"
install -o root -g root -m 440 "$sudo_rule" /etc/sudoers.d/tripdock-release
install -d -o root -g root -m 755 /home/tripdock-deploy/.ssh
entry="restrict,command=\"/usr/bin/python3 -I /usr/local/lib/tripdock/release_gateway.py dispatch\" $(cat "$public_key")"
touch /home/tripdock-deploy/.ssh/authorized_keys
if ! grep -Fxq "$entry" /home/tripdock-deploy/.ssh/authorized_keys; then
  printf '%s\n' "$entry" >> /home/tripdock-deploy/.ssh/authorized_keys
fi
chown root:root /home/tripdock-deploy /home/tripdock-deploy/.ssh/authorized_keys
chmod 755 /home/tripdock-deploy
chmod 644 /home/tripdock-deploy/.ssh/authorized_keys
echo 'Restricted TripDock deployment account installed.'
