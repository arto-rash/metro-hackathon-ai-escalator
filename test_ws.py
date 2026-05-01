import asyncio
import websockets
import json
async def test():
    try:
        url = "ws://localhost:8000/ws/analyze/28MAY11%20ESKALATOR%20UST-16.04.2026%20SAAT%2008.45"
        async with websockets.connect(url) as w:
            while True:
                msg = await w.recv()
                print(msg)
                break
    except Exception as e:
        print(f"Error: {e}")
asyncio.run(test())
