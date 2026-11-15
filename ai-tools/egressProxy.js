import dns from 'node:dns/promises'
import net from 'node:net'

// The only way the headless browser (ai-tools/browser.js) reaches the network: a proxy on this
// machine that lets it connect to public addresses alone. A web page, a redirect or a page's own
// scripts can't reach rook, Lemonade, the rest of this machine, the local network, the tailnet
// or a cloud metadata address, whatever name is used for them.
//
// The proxy looks the host up itself and connects to the address it checked, so a name that
// resolves to a public address when checked and a private one a moment later (DNS rebinding)
// can't get through. Chrome sends it the host name and never resolves names itself.
//
// Only HTTPS tunnels (CONNECT) are made. Plain HTTP is refused; readPage upgrades http:// URLs
// to https:// (see ai-tools/webReader.js).

// The ports a tunnel may go to. Chrome tunnels every https:// and wss:// connection, so 443 is
// all ordinary sites need.
const allowedPorts = [443]

// A tunnel that's quiet this long is closed
const idleTimeout = 1000 * 60

// How much a tunnel may carry from the site, so a huge file can't fill memory
const maxTunnelBytes = 1024 * 1024 * 25

// How long the request line and headers may take to arrive, and how big they may be
const headTimeout = 1000 * 10
const maxHeadBytes = 1024 * 16

const lookupTimeout = 1000 * 10
const connectTimeout = 1000 * 15

// Addresses that aren't on the public internet. IPv4 addresses inside IPv6 ones are unwrapped
// and checked as IPv4 (see publicAddress).
const blocked = new net.BlockList()

const blockedIPv4 = [
  [`0.0.0.0`, 8], // "this network"
  [`10.0.0.0`, 8], // private
  [`100.64.0.0`, 10], // carrier-grade NAT, which Tailscale uses
  [`127.0.0.0`, 8], // loopback
  [`169.254.0.0`, 16], // link-local, cloud metadata
  [`172.16.0.0`, 12], // private
  [`192.0.0.0`, 24], // IETF protocol assignments
  [`192.0.2.0`, 24], // documentation
  [`192.88.99.0`, 24], // 6to4 relay
  [`192.168.0.0`, 16], // private
  [`198.18.0.0`, 15], // benchmarking
  [`198.51.100.0`, 24], // documentation
  [`203.0.113.0`, 24], // documentation
  [`224.0.0.0`, 4], // multicast
  [`240.0.0.0`, 4], // reserved, broadcast
]

const blockedIPv6 = [
  [`::`, 128], // unspecified
  [`::1`, 128], // loopback
  [`100::`, 64], // discard
  [`2001:db8::`, 32], // documentation
  [`fc00::`, 7], // unique local
  [`fe80::`, 10], // link-local
  [`fec0::`, 10], // old site-local
  [`ff00::`, 8], // multicast
]

for (const [address, prefix] of blockedIPv4) {
  blocked.addSubnet(address, prefix, `ipv4`)
}

for (const [address, prefix] of blockedIPv6) {
  blocked.addSubnet(address, prefix, `ipv6`)
}

// The IPv4 address inside an IPv6 one that carries one (::ffff:a.b.c.d, NAT64's
// 64:ff9b::a.b.c.d, 6to4's 2002:aabb:ccdd::), or null
const embeddedIPv4 = function (address) {
  const groups = expandIPv6(address)

  if (groups == null) {
    return null
  }

  const toIPv4 = function (high, low) {
    return [high >> 8, high & 255, low >> 8, low & 255].join(`.`)
  }

  const isZero = function (from, to) {
    return groups.slice(from, to).every(function (group) {
      return group === 0
    })
  }

  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (the old compatible form)
  if (isZero(0, 5) && (groups[5] === 0xffff || groups[5] === 0)) {
    return toIPv4(groups[6], groups[7])
  }

  // 64:ff9b::a.b.c.d and 64:ff9b:1::/48
  if (groups[0] === 0x64 && groups[1] === 0xff9b) {
    return toIPv4(groups[6], groups[7])
  }

  // 2002:aabb:ccdd::/48
  if (groups[0] === 0x2002) {
    return toIPv4(groups[1], groups[2])
  }

  return null
}

// An IPv6 address => its eight 16-bit groups, or null
const expandIPv6 = function (address) {
  let text = address.toLowerCase()

  // A trailing dotted IPv4 part becomes two groups
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)

  if (dotted != null) {
    const parts = dotted[2].split(`.`).map(Number)
    text = `${dotted[1]}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`
  }

  const halves = text.split(`::`)

  if (halves.length > 2) {
    return null
  }

  const head = halves[0] === `` ? [] : halves[0].split(`:`)
  const tail = halves.length === 2 && halves[1] !== `` ? halves[1].split(`:`) : []
  const missing = 8 - head.length - tail.length

  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null
  }

  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill(`0`), ...tail].map(function (group) {
    return parseInt(group, 16)
  })

  if (groups.length !== 8 || groups.some(Number.isNaN)) {
    return null
  }

  return groups
}

// Whether `address` (an IP address) is on the public internet
export const isPublicAddress = function (address) {
  const family = net.isIP(address)

  if (family === 4) {
    return blocked.check(address, `ipv4`) === false
  }

  if (family === 6) {
    const inner = embeddedIPv4(address)

    if (inner != null) {
      return isPublicAddress(inner)
    }

    return blocked.check(address, `ipv6`) === false
  }

  return false
}

// The address to connect to for `host`: its first address, when every address it has is public.
// Throws, with why, otherwise.
const resolvePublic = async function (host) {
  // [::1] in a URL arrives as ::1
  const name = host.replace(/^\[(.*)\]$/, `$1`)

  if (net.isIP(name) !== 0) {
    if (isPublicAddress(name) === false) {
      throw new Error(`${name} isn't a public address`)
    }

    return name
  }

  const lookup = dns.lookup(name, { all: true, verbatim: true })
  const timeout = new Promise(function (resolve, reject) {
    setTimeout(() => reject(new Error(`looking up ${name} took too long`)), lookupTimeout).unref?.()
  })
  const addresses = await Promise.race([lookup, timeout])

  if (addresses.length === 0) {
    throw new Error(`${name} has no address`)
  }

  // All of them, so a name can't list a public address first and a private one after
  for (const { address } of addresses) {
    if (isPublicAddress(address) === false) {
      throw new Error(`${name} resolves to ${address}, which isn't a public address`)
    }
  }

  return addresses[0].address
}

const refuse = function (socket, status, reason) {
  console.log(`Web proxy refused: ${reason}`)

  if (socket.writable) {
    socket.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${reason}\n`)
  }
}

// Reads the request line and headers, then makes the tunnel, or refuses
const handleConnection = function (client) {
  let head = Buffer.alloc(0)

  client.setTimeout(headTimeout)
  client.on(`timeout`, () => client.destroy())
  client.on(`error`, () => client.destroy())

  const onData = async function (chunk) {
    head = Buffer.concat([head, chunk])

    const end = head.indexOf(`\r\n\r\n`)

    if (end === -1) {
      if (head.length > maxHeadBytes) {
        client.removeListener(`data`, onData)
        refuse(client, `431 Request Header Fields Too Large`, `request headers too large`)
      }

      return
    }

    client.removeListener(`data`, onData)
    client.pause()

    const [method, target] = head.subarray(0, end).toString(`latin1`).split(`\r\n`)[0].split(` `)
    const rest = head.subarray(end + 4)

    if (method !== `CONNECT`) {
      refuse(client, `403 Forbidden`, `only HTTPS is allowed (${method} ${target})`)
      return
    }

    const match = (target ?? ``).match(/^(\[[^\]]+\]|[^:]+):(\d+)$/)

    if (match == null) {
      refuse(client, `400 Bad Request`, `bad CONNECT target "${target}"`)
      return
    }

    const host = match[1]
    const port = Number(match[2])

    if (allowedPorts.includes(port) === false) {
      refuse(client, `403 Forbidden`, `port ${port} isn't allowed (${host})`)
      return
    }

    let address

    try {
      address = await resolvePublic(host)
    } catch (err) {
      refuse(client, `403 Forbidden`, err.message)
      return
    }

    if (client.destroyed) {
      return
    }

    // To the address that was checked, never to the name again
    const upstream = net.connect({ host: address, port, timeout: connectTimeout })
    let isConnected = false

    upstream.once(`connect`, function () {
      isConnected = true
      upstream.setTimeout(idleTimeout)
      client.setTimeout(idleTimeout)

      client.write(`HTTP/1.1 200 Connection Established\r\n\r\n`)

      if (rest.length > 0) {
        upstream.write(rest)
      }

      let received = 0

      upstream.on(`data`, function (data) {
        received += data.length

        if (received > maxTunnelBytes) {
          console.log(`Web proxy closed a tunnel to ${host}: more than ${maxTunnelBytes} bytes`)
          upstream.destroy()
          client.destroy()
        }
      })

      upstream.pipe(client)
      client.pipe(upstream)
      client.resume()
    })

    upstream.on(`timeout`, function () {
      if (isConnected === false) {
        refuse(client, `504 Gateway Timeout`, `connecting to ${host} took too long`)
      } else {
        client.destroy()
      }

      upstream.destroy()
    })

    upstream.on(`error`, function (err) {
      if (isConnected === false) {
        refuse(client, `502 Bad Gateway`, `couldn't connect to ${host}: ${err.message}`)
      } else {
        client.destroy()
      }
    })

    // Once refused, the client is closed by refuse(), after the answer is written
    upstream.on(`close`, function () {
      if (isConnected) {
        client.destroy()
      }
    })
    client.on(`close`, () => upstream.destroy())
  }

  client.on(`data`, onData)
}

let serverPromise = null

// Starts the proxy on first use and returns its address, like http://127.0.0.1:41234
export const getProxyURL = async function () {
  if (serverPromise == null) {
    serverPromise = new Promise(function (resolve, reject) {
      const server = net.createServer(handleConnection)

      server.once(`error`, function (err) {
        serverPromise = null
        reject(err)
      })

      // A random free port, on this machine only
      server.listen(0, `127.0.0.1`, function () {
        resolve(server)
      })
    })
  }

  const server = await serverPromise

  return `http://127.0.0.1:${server.address().port}`
}

export default {
  getProxyURL,
  isPublicAddress,
}
