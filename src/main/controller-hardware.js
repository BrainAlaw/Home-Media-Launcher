'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DONGLE_PRODUCTS = new Set(['02e6', '02fe']);
const MAC = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const cleanText = (value) => String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 160);
const batteryPercent = (value) => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? Math.round(Number(value)) : null;
const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);

/** All paths originate from OS enumeration, never renderer arguments. */
class LinuxControllerHardware {
  constructor({ sysRoot = '/sys', fs: filesystem = fs } = {}) { this.root = path.resolve(sysRoot); this.fs = filesystem; }
  async text(file) { try { return (await this.fs.readFile(file, 'utf8')).trim(); } catch { return ''; } }
  async entries(directory) { try { return (await this.fs.readdir(directory)).slice(0, 512); } catch { return []; } }
  async real(file) { try { const real = await this.fs.realpath(file); return within(this.root, real) ? real : ''; } catch { return ''; } }

  async dongles() {
    const modules = await this.entries(path.join(this.root, 'module'));
    const xone = modules.some((name) => /^xone(?:_|$)/.test(name));
    const xpadneo = modules.some((name) => /^(?:hid_)?xpadneo$/.test(name));
    const usb = path.join(this.root, 'bus/usb/devices');
    const receivers = [];
    for (const name of await this.entries(usb)) {
      if (!/^\d+-[\d.]+$/.test(name)) continue;
      const directory = path.join(usb, name);
      const [vendor, product] = await Promise.all([this.text(path.join(directory, 'idVendor')), this.text(path.join(directory, 'idProduct'))]);
      if (vendor.toLowerCase() === '045e' && DONGLE_PRODUCTS.has(product.toLowerCase())) receivers.push(directory);
    }
    const interfaces = [];
    const driverRoot = path.join(this.root, 'bus/usb/drivers/xone-dongle');
    for (const name of await this.entries(driverRoot)) {
      if (!/^\d+-[\d.]+:\d+\.\d+$/.test(name)) continue;
      const directory = await this.real(path.join(driverRoot, name));
      if (!directory) continue;
      const parent = path.dirname(directory);
      const [vendor, product] = await Promise.all([this.text(path.join(parent, 'idVendor')), this.text(path.join(parent, 'idProduct'))]);
      if (vendor.toLowerCase() !== '045e' || !DONGLE_PRODUCTS.has(product.toLowerCase())) continue;
      const attribute = path.join(directory, 'pairing');
      if (/^[01]$/.test(await this.text(attribute))) interfaces.push({ directory, attribute });
    }
    return { present: receivers.length > 0 || interfaces.length > 0, driver: xone || interfaces.length ? 'xone' : xpadneo ? 'xpadneo' : null,
      pairingSupported: interfaces.length > 0, interfaces };
  }

  async inputPath(controller) {
    if (!controller.sysfs || !/^\/devices\//.test(controller.sysfs) || controller.sysfs.includes('..')) return '';
    return this.real(path.join(this.root, controller.sysfs));
  }

  async enrich(controllers, dongles) {
    const supplies = await this.entries(path.join(this.root, 'class/power_supply'));
    const paths = new Map();
    for (const controller of controllers) {
      const input = await this.inputPath(controller); paths.set(controller.id, input);
      if (input && dongles.interfaces.some((entry) => within(entry.directory, input))) controller.transport = 'dongle';
    }
    for (const name of supplies) {
      const directory = path.join(this.root, 'class/power_supply', name);
      const [supply, device, serial, capacity, status] = await Promise.all([
        this.real(directory), this.real(path.join(directory, 'device')), this.text(path.join(directory, 'serial_number')),
        this.text(path.join(directory, 'capacity')), this.text(path.join(directory, 'status'))
      ]);
      for (const controller of controllers) {
        const input = paths.get(controller.id);
        // xone battery/input share a GIP client; HID batteries share the physical HID parent.
        const inputParent = input ? path.dirname(input).replace(/[\\/]input$/, '') : '';
        const address = MAC.test(controller.id) && (serial.toUpperCase() === controller.id || name.toUpperCase().includes(controller.id));
        const related = inputParent && inputParent !== path.join(this.root, 'devices') &&
          ((device && within(inputParent, device)) || (supply && within(inputParent, supply)));
        if (!address && !related) continue;
        controller.battery = batteryPercent(capacity); controller.charging = /^charging$/i.test(status);
      }
    }
    return paths;
  }

  async setPairing(entry, enabled) {
    // Re-resolve immediately before writing: only a verified bound Microsoft USB interface is writable.
    const directory = await this.real(entry.directory);
    if (directory !== entry.directory) throw Object.assign(new Error('Wireless receiver was removed.'), { code: 'ENOENT' });
    const [vendor, product] = await Promise.all([this.text(path.join(path.dirname(directory), 'idVendor')), this.text(path.join(path.dirname(directory), 'idProduct'))]);
    if (vendor.toLowerCase() !== '045e' || !DONGLE_PRODUCTS.has(product.toLowerCase())) throw new Error('Wireless receiver changed.');
    await this.fs.writeFile(path.join(directory, 'pairing'), enabled ? '1\n' : '0\n');
  }
}

module.exports = { LinuxControllerHardware, cleanText, batteryPercent, within };
