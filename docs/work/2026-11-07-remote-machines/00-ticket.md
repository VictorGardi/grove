i want to be able to install grove (core) on my headless rpi (linux). check specifics about it by running ssh pi. only do read actions on it. then i want to add functionality to grove so i can on gronve on my computer choose to add machine pi and i see its spaces and tabs in my grove ui. see image for functionality i want.

Image: a sidebar titled "Every machine in one sidebar". Header "Spaces" with a + button. Groups per machine: "This computer", "macbook", "vps", each with a machine icon, a +, a green status dot and a collapse chevron. Under each machine its spaces: letter avatar, name, branch name, a dot, and a spinner or green dot for agent status. Caption: "Add any machine you can reach over SSH, like a server, a VM or a cloud sandbox. Its spaces and agents show up in the same sidebar under its name, and you start agents there the same way." CLI: `hc machine add vps` (or ask your agent: "add my server vps"). "Its agents keep running there while your laptop sleeps or the app is closed."

## Facts gathered from `ssh pi` (read-only)

- Raspberry Pi, Debian 12 bookworm, aarch64, kernel 6.1 rpi7, 4 cores, 3.8 GB RAM, 8.9 GB free disk, up 129 days. User `victor`, bash. Host entry `pi` in ~/.ssh/config: 192.168.0.116, key ~/.ssh/id_ed25519.
- Installed: git, python3, gcc, make. Not installed: node, npm, bun, cargo, rust, go, tmux. `claude` exists in ~/.local/bin (not on the non-interactive PATH). apt offers nodejs 18.20.4 only. Passwordless sudo works. A git checkout already exists at ~/git/grove.
- Ports in use on the Pi include 80, 8080, 8123, 1880, 1883, 5433.
