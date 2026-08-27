#!/usr/bin/env python3
import asyncio, socket, struct

async def pipe(r, w):
    try:
        while True:
            data = await r.read(65536)
            if not data:
                break
            w.write(data); await w.drain()
    except Exception:
        pass
    finally:
        try: w.close()
        except Exception: pass

async def handle(reader, writer):
    try:
        ver, nm = struct.unpack("!BB", await reader.readexactly(2))
        await reader.readexactly(nm)
        writer.write(b"\x05\x00"); await writer.drain()
        ver, cmd, _rsv, atyp = struct.unpack("!BBBB", await reader.readexactly(4))
        if atyp == 1:
            host = socket.inet_ntoa(await reader.readexactly(4))
        elif atyp == 3:
            ln = (await reader.readexactly(1))[0]
            host = (await reader.readexactly(ln)).decode()
        else:
            writer.write(b"\x05\x08\x00\x01\x00\x00\x00\x00\x00\x00"); await writer.drain(); writer.close(); return
        port = struct.unpack("!H", await reader.readexactly(2))[0]
        if cmd != 1:
            writer.write(b"\x05\x07\x00\x01\x00\x00\x00\x00\x00\x00"); await writer.drain(); writer.close(); return
        try:
            rr, rw = await asyncio.open_connection(host, port)
        except Exception as e:
            print(f"proxy: upstream connect FAILED {host}:{port} {e}", flush=True)
            writer.write(b"\x05\x05\x00\x01\x00\x00\x00\x00\x00\x00"); await writer.drain(); writer.close(); return
        print(f"proxy: connected -> {host}:{port}", flush=True)
        writer.write(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00"); await writer.drain()
        await asyncio.gather(pipe(reader, rw), pipe(rr, writer))
    except Exception:
        try: writer.close()
        except Exception: pass

async def main():
    srv = await asyncio.start_server(handle, "0.0.0.0", 1080)
    print("SOCKS5 proxy (subnet-router stand-in) listening on 0.0.0.0:1080", flush=True)
    async with srv:
        await srv.serve_forever()

asyncio.run(main())
