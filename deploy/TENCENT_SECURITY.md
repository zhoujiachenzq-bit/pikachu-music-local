# 腾讯云服务器安全配置准备（v0.3.1）

这份清单适用于当前的 Ubuntu 24.04、Caddy、Docker 和 `zqmusic.cn`。应用升级脚本不会修改 Caddy、腾讯云防火墙或 SSH，避免远程部署时把管理员锁在服务器外。

## 1. 部署应用

GitHub Release 发布后，在服务器检出 v0.3.1，并从仓库目录执行：

```bash
sudo apt-get update
sudo apt-get install -y sqlite3
sudo bash deploy/tencent-v0.3.1.sh
```

脚本会构建 `zqmusic:0.3.1`、将 SQLite 备份到 `/opt/zqmusic-backups`、保留原容器用于回滚，并以只读根文件系统、无额外 capabilities、进程/内存限制和日志轮转启动新容器。应用仅映射 `127.0.0.1:3000`，Caddy 与 `/opt/zqmusic-data` 不变；现有内部备用音源地址会原样保留。

部署后手动检查：

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS https://zqmusic.cn/api/health
docker ps --filter name=zqmusic-app
docker inspect -f '{{json .State.Health}}' zqmusic-app
```

然后在网页检查登录、收藏数量、歌单数量、搜索和实际播放。确认无误前不要删除脚本输出的 rollback 容器和备份。

## 2. 腾讯云防火墙

- 保留 TCP 80、443 对全部 IPv4/IPv6开放。
- SSH 22 只允许你当前的公网 IP `/32`，不要保留“全部 IPv4 地址”规则。
- `3000`、`8080` 和 Caddy 管理端口 `2019` 不应开放公网。
- 如果以后只使用腾讯云网页终端，可在确认网页终端能够救援后关闭公网 22。

## 3. SSH 分阶段加固

先保持当前腾讯云网页终端和第二个 SSH 会话同时在线，确认密钥登录成功后再修改。建议在 `/etc/ssh/sshd_config.d/99-zqmusic-hardening.conf` 配置：

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
X11Forwarding no
MaxAuthTries 4
LoginGraceTime 30
```

修改后先检查配置，不要直接关闭当前会话：

```bash
sudo sshd -t
sudo systemctl reload ssh
```

用第二个会话完成一次密钥登录；只有成功后才退出原会话。若尚未配置密钥，不要关闭密码登录。

## 4. 主机防火墙与登录保护

只有在 22 端口来源 IP 已确认后再启用 UFW：

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw allow from 你的公网IP to any port 22 proto tcp
sudo ufw enable
sudo ufw status verbose
```

密码登录完全关闭前可安装 Fail2ban；关闭密码登录后仍可保留它监控异常 SSH 尝试。

## 5. 数据和备份

```bash
sudo install -d -o root -g root -m 700 /opt/zqmusic-backups
sudo find /opt/zqmusic-backups -type f -exec chmod 600 {} +
sudo find /opt/zqmusic-data/backups -type f -name '*.sqlite' -exec chmod 600 {} + 2>/dev/null || true
```

新备份不再放进应用容器挂载的 `/opt/zqmusic-data`。建议定期将 `/opt/zqmusic-backups` 加密复制到另一台设备，并实际测试恢复。

## 6. 回滚

若部署后业务检查失败，先找到脚本保留的旧容器名：

```bash
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep zqmusic-app
```

随后停止并改名新容器，把旧容器恢复为 `zqmusic-app`，再启动它。不要覆盖 `/opt/zqmusic-data`；只有确认发生数据库迁移问题时才从 `/opt/zqmusic-backups` 恢复，并在恢复前再做一份当前数据库副本。
