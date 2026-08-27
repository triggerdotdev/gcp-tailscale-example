FROM alpine:3.20
RUN apk add --no-cache wireguard-tools iptables iproute2 bash
COPY start.sh /start.sh
RUN chmod +x /start.sh
ENTRYPOINT ["/start.sh"]
