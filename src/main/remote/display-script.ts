// POSIX sh script that runs on the school server (TigerVNC 1.8, csh login shell).
// It is uploaded to ~/.sogangssh/display.sh and run over an SSH exec channel:
//
//   sh display.sh attach <width> <height> <idle limit seconds, 0 = none>
//   sh display.sh stop
//
// One persistent desktop per user, kept in ~/.sogangssh/session (mode 700):
//   info         N, PORT, XPID of the running Xvnc
//   password     the session's VNC password (reused on every reattach)
//   passwd       the same password in vncpasswd format, read by Xvnc
//   Xauthority   the X cookie for the display
// Xvnc and the window manager run detached (setsid, nohup), so closing the app or losing the
// network does not stop them. "attach" reuses the running desktop, or cleans up leftovers and
// starts a new one. "stop" ends the desktop and every program drawing on it.
//
// Protocol on stdout (one line):
//   READY display=<N> port=<P> password=<VNC password> xauthority=<path> reused=<0|1>
//   STOPPED
//   ERROR <code> <detail>
//
// Shared server, so: Xvnc listens on localhost only and asks for a random VNC password, and the
// X display requires a cookie from a private Xauthority file.
// The script must never contain a dollar sign followed by an opening brace:
// String.raw would treat it as a JavaScript placeholder.
export const DISPLAY_SCRIPT = String.raw`#!/bin/sh
MODE="$1"
umask 077
DIR="$HOME/.sogangssh"
SESSION="$DIR/session"
mkdir -p "$DIR" && chmod 700 "$DIR" || { echo "ERROR startFailed cannot create $DIR"; exit 1; }

# One call at a time per user, so two PCs logging in at once never start two desktops.
# Background programs must not inherit this descriptor (9>&-), or the lock would never free.
exec 9> "$DIR/lock"
if command -v flock >/dev/null 2>&1; then
  flock -w 30 9 || { echo "ERROR startFailed the session is busy"; exit 1; }
fi

# Per-run folders of the older stage 5 script whose script is no longer running.
for d in "$DIR"/session.*; do
  [ -d "$d" ] || continue
  pid=$(echo "$d" | sed 's/.*session[.]//')
  kill -0 "$pid" 2>/dev/null || rm -rf "$d"
done

N=""; PORT=""; XPID=""
[ -f "$SESSION/info" ] && . "$SESSION/info"
case "$N" in ''|*[!0-9]*) N="" ;; esac
case "$PORT" in ''|*[!0-9]*) PORT="" ;; esac
case "$XPID" in ''|*[!0-9]*) XPID="" ;; esac

xvnc_alive() {
  [ -n "$XPID" ] && [ -n "$N" ] || return 1
  kill -0 "$XPID" 2>/dev/null || return 1
  tr '\0' ' ' < "/proc/$XPID/cmdline" 2>/dev/null | grep -q "Xvnc :$N "
}

has_terminal_marker() {
  { tr '\0' '\n' < "/proc/$1/environ"; } 2>/dev/null | grep -qx "SOGANGSSH_TERMINAL=1"
}

# Print every own process that runs on display N (programs, window manager, simulations and the
# scripts that drive them). Left out: login shells ("-csh") and the app's terminal shell itself.
# That shell is started with DISPLAY and SOGANGSSH_TERMINAL=1 so programs typed in it land on the
# desktop. Everything started from it inherits the marker, so only the topmost marked process (its
# parent has no marker) is the terminal; a marked process with a marked parent is listed.
display_programs() {
  [ -n "$N" ] || return 0
  for p in $(ps -u "$(id -u)" -o pid=); do
    [ "$p" = "$$" ] && continue
    { tr '\0' '\n' < "/proc/$p/environ"; } 2>/dev/null | grep -qx "DISPLAY=:$N" || continue
    case "$({ tr '\0' '\n' < "/proc/$p/cmdline"; } 2>/dev/null | head -n 1)" in
      -*) continue ;;
    esac
    if has_terminal_marker "$p"; then
      parent=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
      [ -n "$parent" ] && has_terminal_marker "$parent" || continue
    fi
    echo "$p"
  done
}

# The list is taken once, before any signal: a stopped runner script leaves its children orphaned
# (their parent becomes init), and on a second look they would pass for the terminal shell.
stop_session() {
  TARGETS=$(display_programs)
  [ -n "$TARGETS" ] && kill -TERM $TARGETS 2>/dev/null
  xvnc_alive && kill "$XPID" 2>/dev/null
  sleep 2
  # Also catch anything started in the meantime.
  TARGETS="$TARGETS $(display_programs)"
  [ -n "$(echo $TARGETS)" ] && kill -KILL $TARGETS 2>/dev/null
  xvnc_alive && kill -9 "$XPID" 2>/dev/null
  rm -rf "$SESSION"
}

case "$MODE" in
  stop)
    stop_session
    echo "STOPPED"
    exit 0
    ;;
  attach) ;;
  *) echo "ERROR startFailed unknown mode $MODE"; exit 1 ;;
esac

W="$2"; H="$3"; IDLE="$4"
case "$W" in ''|*[!0-9]*) W=1600 ;; esac
case "$H" in ''|*[!0-9]*) H=900 ;; esac
case "$IDLE" in ''|*[!0-9]*) IDLE=0 ;; esac

# Reattach: same display, same password.
if xvnc_alive && [ -s "$SESSION/password" ]; then
  echo "READY display=$N port=$PORT password=$(cat "$SESSION/password") xauthority=$SESSION/Xauthority reused=1"
  exit 0
fi

# No running desktop: stop what a dead session left behind (it may still hold licenses).
stop_session
N=""; PORT=""; XPID=""

command -v Xvnc >/dev/null 2>&1 || { echo "ERROR noXvnc Xvnc not found"; exit 1; }

mkdir -p "$SESSION"
XAUTH="$SESSION/Xauthority"
: > "$XAUTH"

PASS=$(head -c 6 /dev/urandom | base64 | tr -d '\n')
printf '%s\n' "$PASS" | vncpasswd -f > "$SESSION/passwd" 2>/dev/null
[ -s "$SESSION/passwd" ] || { rm -rf "$SESSION"; echo "ERROR startFailed vncpasswd failed"; exit 1; }
printf '%s\n' "$PASS" > "$SESSION/password"
COOKIE=$(mcookie 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')

LIFETIME=""
[ "$IDLE" -gt 0 ] && LIFETIME="-MaxDisconnectionTime $IDLE"

# Try the previous session's display number first, so a terminal that already has DISPLAY set
# keeps working after the desktop is restarted.
PREF=$(cat "$DIR/display" 2>/dev/null)
case "$PREF" in ''|*[!0-9]*) PREF="" ;; esac
READY=0
for N in $PREF $(seq 20 99); do
  if [ -e "/tmp/.X$N-lock" ] || [ -e "/tmp/.X11-unix/X$N" ]; then
    continue
  fi
  PORT=$((5900 + N))
  # The cookie goes in over stdin: other users can see command lines in ps on this server.
  printf 'add :%s . %s\n' "$N" "$COOKIE" | xauth -f "$XAUTH" source - >/dev/null 2>&1
  setsid nohup Xvnc ":$N" -localhost -nolisten tcp -rfbport "$PORT" \
    -SecurityTypes VncAuth -rfbauth "$SESSION/passwd" -auth "$XAUTH" \
    -geometry "$W"x"$H" -depth 24 -desktop sogangSSH -SendPrimary=0 $LIFETIME \
    > "$SESSION/xvnc.log" 2>&1 < /dev/null 9>&- &
  i=0
  while [ "$i" -lt 50 ]; do
    if grep -q "Listening for VNC connections" "$SESSION/xvnc.log" 2>/dev/null; then
      READY=1
      break
    fi
    grep -q -i -E "fatal|already" "$SESSION/xvnc.log" 2>/dev/null && break
    sleep 0.2
    i=$((i + 1))
  done
  if [ "$READY" -eq 1 ]; then
    # Xvnc writes its own PID into the X lock file.
    XPID=$(tr -d ' \n' < "/tmp/.X$N-lock" 2>/dev/null)
    case "$XPID" in ''|*[!0-9]*) XPID=$! ;; esac
    break
  else
    # Display or port taken by someone else: try the next number.
    kill $! 2>/dev/null
    xauth -f "$XAUTH" remove ":$N" >/dev/null 2>&1
  fi
done
[ "$READY" -eq 1 ] || { rm -rf "$SESSION"; echo "ERROR startFailed no free display"; exit 1; }

printf 'N=%s\nPORT=%s\nXPID=%s\n' "$N" "$PORT" "$XPID" > "$SESSION/info"
echo "$N" > "$DIR/display"

DISPLAY=":$N"
XAUTHORITY="$XAUTH"
export DISPLAY XAUTHORITY

WM_STARTED=0
if command -v metacity >/dev/null 2>&1; then
  setsid nohup metacity --replace > "$SESSION/wm.log" 2>&1 < /dev/null 9>&- &
  WM_PID=$!
  sleep 1
  kill -0 "$WM_PID" 2>/dev/null && WM_STARTED=1
fi
if [ "$WM_STARTED" -eq 0 ] && command -v mwm >/dev/null 2>&1; then
  setsid nohup mwm > "$SESSION/wm.log" 2>&1 < /dev/null 9>&- &
fi
command -v xsetroot >/dev/null 2>&1 && xsetroot -solid '#27272a' 2>/dev/null

echo "READY display=$N port=$PORT password=$PASS xauthority=$XAUTH reused=0"
exit 0
`
