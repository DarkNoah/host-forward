#!/usr/bin/env bash
set -euo pipefail

# 生成包含 SAN 的自签名证书，默认输出到 certs/
# 可通过环境变量覆盖：
#   SSL_CN:       证书 Common Name，默认 localhost
#   SSL_DNS:      以逗号分隔的 DNS 列表，默认 localhost,127.0.0.1
#   SSL_DAYS:     有效天数，默认 825（Chrome 允许的上限附近）
#   SSL_OUT_DIR:  输出目录，默认 certs

SSL_CN=${SSL_CN:-localhost}
SSL_DNS=${SSL_DNS:-localhost,127.0.0.1}
SSL_DAYS=${SSL_DAYS:-825}
SSL_OUT_DIR=${SSL_OUT_DIR:-certs}

mkdir -p "$SSL_OUT_DIR"

KEY_PATH="$SSL_OUT_DIR/server.key"
CERT_PATH="$SSL_OUT_DIR/server.crt"
CSR_PATH="$SSL_OUT_DIR/server.csr"
CONF_PATH="$SSL_OUT_DIR/openssl.cnf"

IFS=',' read -r -a DNS_ARRAY <<< "$SSL_DNS"

# 生成 openssl 配置（包含 subjectAltName）
cat > "$CONF_PATH" <<EOF
[ req ]
default_bits       = 2048
distinguished_name = req_distinguished_name
req_extensions     = req_ext
prompt             = no

[ req_distinguished_name ]
CN = $SSL_CN

[ req_ext ]
subjectAltName = @alt_names

[ alt_names ]
EOF

idx=1
for host in "${DNS_ARRAY[@]}"; do
  # 自动识别 IP 与 DNS
  if [[ "$host" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
    echo "IP.$idx = $host" >> "$CONF_PATH"
  else
    echo "DNS.$idx = $host" >> "$CONF_PATH"
  fi
  idx=$((idx+1))
done

echo "[INFO] Using CN=$SSL_CN, SAN=$SSL_DNS, DAYS=$SSL_DAYS -> $SSL_OUT_DIR"

# 生成私钥
openssl genrsa -out "$KEY_PATH" 2048 1>/dev/null

# 生成 CSR（带 SAN）
openssl req -new -key "$KEY_PATH" -out "$CSR_PATH" -config "$CONF_PATH" 1>/dev/null

# 自签名证书
openssl x509 -req -days "$SSL_DAYS" -in "$CSR_PATH" -signkey "$KEY_PATH" -out "$CERT_PATH" -extensions req_ext -extfile "$CONF_PATH" 1>/dev/null

echo "[DONE] Key: $KEY_PATH"
echo "[DONE] Cert: $CERT_PATH"
echo "[HINT] 在运行前设置环境变量: HTTPS_PORT, HTTPS_KEY_PATH, HTTPS_CERT_PATH"

