/**
 * Fetching a URL.
 *
 * The app's own `fetch_url`: the same public-host guard, so a request cannot be pointed at the
 * machine or the networks beside it, and the same cap on the body.
 */

import { Args } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { fetchUrl } from '../../lib/host/exec';

export default class ExecFetch extends LabCommand {
  static description = 'Fetch a public URL and print its body';

  static args = {
    url: Args.string({ required: true, description: 'A public http(s) URL' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ExecFetch);
    const body = await fetchUrl(args.url);
    this.emit({ url: args.url, bytes: Buffer.byteLength(body), body }, (value) => value.body);
  }
}
