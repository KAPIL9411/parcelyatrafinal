import { Link } from 'react-router-dom';

import { useDocumentTitle } from '../lib/hooks';
import { Button, Card } from '../components/ui';
import { SearchIcon } from '../components/icons';

export function NotFound() {
  useDocumentTitle('Page not found');

  return (
    <div className="mx-auto max-w-lg py-8">
      <Card className="text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-700">
          <SearchIcon size={24} />
        </span>
        <h1 className="text-xl font-semibold text-ink-900">We could not find that page</h1>
        <p className="mt-2 text-sm text-ink-700">
          The link may be old, or the page may belong to another account. Nothing was changed.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to="/">
            <Button>Go to the home page</Button>
          </Link>
          <Link to="/help">
            <Button variant="secondary">Get help</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
