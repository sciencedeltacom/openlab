/**
 * The credentials the CLI has.
 *
 * Two places, read the way the model factory reads them: the environment first, then the CLI’s
 * own vault. Providers name the variables they read; the science connectors need none; and
 * anything else in the vault — a target’s or a cloud store’s key — is listed by name so a
 * reader can see it is there. Values are never printed.
 */

import { mergeProviders } from '@/lib/providers';
import { SCIENCE_CONNECTORS } from '@/lib/science/connectors';

import { LabCommand } from '../../../lib/base';
import { catalogProviders, envFor } from '../../../lib/catalog';
import { providerKey, secretNames } from '../../../lib/host/secrets';

export default class ToolsCredentialsList extends LabCommand {
  static description = 'List the credentials in play: the environment and the CLI’s own vault';

  async run(): Promise<void> {
    await this.parse(ToolsCredentialsList);
    const lab = await this.lab({ root: null });
    const providers = mergeProviders([...catalogProviders(), ...lab.state.customProviders]);

    const rows: { surface: string; id: string; label: string; credential: string; state: string }[] = [];
    const named = new Set<string>();
    for (const provider of providers) {
      const names = envFor(provider.id);
      named.add(provider.id);
      for (const name of names) named.add(name);
      rows.push({
        surface: 'provider',
        id: provider.id,
        label: provider.label,
        credential: names.join(', ') || `${provider.id.toUpperCase()}_API_KEY`,
        state: !provider.requiresKey ? 'not needed' : providerKey(provider.id, names) ? 'present' : 'missing',
      });
    }
    for (const connector of SCIENCE_CONNECTORS) {
      rows.push({
        surface: 'connector',
        id: connector.id,
        label: connector.label,
        credential: '',
        state: 'not needed',
      });
    }
    // Whatever else the vault holds is a target’s or a connection’s credential; it is named,
    // never read out, so a reader knows the CLI can reach that machine or store.
    for (const name of secretNames()) {
      if (named.has(name)) continue;
      rows.push({ surface: 'vault', id: name, label: '', credential: '', state: 'stored' });
    }

    this.list(
      rows,
      [
        { key: 'surface', label: 'surface' },
        { key: 'id', label: 'id' },
        { key: 'label', label: 'name', truncate: true, width: 24 },
        { key: 'credential', label: 'credential', truncate: true, width: 34 },
        { key: 'state', label: 'state' },
      ],
      'No credentials are named in this build.',
    );
  }
}
