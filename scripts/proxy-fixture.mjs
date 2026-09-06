import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

for (const [port,service] of [[3000,'web'],[4000,'api']]) {
  const server=createServer((req,res)=>{
    if(req.url==='/api/stream') {
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      res.write('data: first\n\n')
      setTimeout(()=>res.end('data: last\n\n'),600)
      return
    }
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':service==='api'?'private, no-cache':'no-cache'})
    req.resume()
    res.end(JSON.stringify({service,path:req.url,headers:req.headers}))
  })
  server.on('upgrade',(req,socket)=>{
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.on('end',()=>socket.end())
  })
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve))
}
console.log('ready')
