// Read-only POSIX sh scripts for the server status panel, fed to `sh -s` over stdin.
// They print one record per line ("<kind> <fields…>") for parseStatus / parseLicenses.
// The scripts must never contain a dollar sign followed by an opening brace (String.raw).

/**
 * System status, run every few seconds. CPU use comes from cumulative CPU time
 * (ps `time`), so the main process turns two samples into "cores in use now".
 *   host <name>
 *   uptime <seconds>
 *   load <1 min> <5 min> <15 min>
 *   cores <n>
 *   mem <total kB> <available kB>
 *   quota <used kB> <soft limit kB> <hard limit kB>     (user quota on the home filesystem)
 *   disk <used kB> <size kB>                            (home filesystem, when there is no quota)
 *   me <user>
 *   session <user> <idle: "." | HH:MM | "old">          (who -u, one per login)
 *   usercpu <user> <cpu seconds> <processes>            (every user with uid >= 1000)
 *   proc <pid> <cpu seconds> <rss kB> <command>         (own processes)
 */
export const STATUS_SCRIPT = String.raw`
echo "host $(hostname -s 2>/dev/null || hostname)"
echo "uptime $(cut -d' ' -f1 /proc/uptime)"
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
echo "cores $(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)"
awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {print "mem", t, a}' /proc/meminfo
Q=$(quota -w 2>/dev/null | awk 'NR > 2 && NF >= 4 {gsub(/\*/, "", $2); print $2, $3, $4; exit}')
if [ -n "$Q" ]; then
  echo "quota $Q"
else
  df -P -k "$HOME" 2>/dev/null | awk 'NR == 2 {print "disk", $3, $2}'
fi
echo "me $(id -un)"
who -u 2>/dev/null | awk '{print "session", $1, $5}'
ps -e -o uid= -o user:32= -o time= 2>/dev/null | awk '
  $1 >= 1000 {
    n = split($3, p, /[-:]/)
    s = p[n] + 60 * p[n-1] + 3600 * p[n-2] + (n > 3 ? 86400 * p[1] : 0)
    cpu[$2] += s; count[$2]++
  }
  END { for (u in cpu) print "usercpu", u, cpu[u], count[u] }'
# Own processes, without SSH plumbing and without this panel's own commands (marked with
# SOGANGSSH_MONITOR=1 by the app, inherited by ps, lmutil and the rest).
ps -u "$(id -u)" -o pid= -o time= -o rss= -o comm= 2>/dev/null | while read -r pid time rss comm; do
  [ "$comm" = "sshd" ] && continue
  # The login shell that started this script (csh -c "env … sh -s").
  [ "$pid" = "$PPID" ] && continue
  # Gone already (e.g. the ps above) or one of ours: skip.
  ENV=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null) || continue
  echo "$ENV" | grep -qx "SOGANGSSH_MONITOR=1" && continue
  echo "$pid $time $rss $comm"
done | awk '{
  n = split($2, p, /[-:]/)
  s = p[n] + 60 * p[n-1] + 3600 * p[n-2] + (n > 3 ? 86400 * p[1] : 0)
  print "proc", $1, s, $3, $4
}'
`

/**
 * License usage, run about once a minute (each feature is a network query to the license
 * server). Arguments are appended by the caller: the license file list, then feature names.
 *   license <feature> <in use> <issued>
 *   licenseError <detail>
 */
export const LICENSE_SCRIPT = String.raw`
LMUTIL=""
for f in /tools/cadence/IC618/tools.lnx86/bin/lmutil /tools/cadence/IC618/bin/lmutil \
  /tools/cadence/SPECTRE201/tools.lnx86/bin/lmutil; do
  [ -x "$f" ] && { LMUTIL="$f"; break; }
done
[ -n "$LMUTIL" ] || { echo "licenseError lmutil not found"; exit 0; }
SERVERS="$1"; shift
for feature in "$@"; do
  line=$(timeout 15 "$LMUTIL" lmstat -c "$SERVERS" -f "$feature" 2>/dev/null | grep "^Users of $feature:")
  if [ -n "$line" ]; then
    echo "$line" | awk -v f="$feature" '{
      for (i = 1; i <= NF; i++) { if ($i == "issued;") issued = $(i-2); if ($i == "in") used = $(i-2) }
      print "license", f, used, issued
    }'
  fi
done
`
