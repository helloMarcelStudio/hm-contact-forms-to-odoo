/**
 * Log tab: every submission sent to Odoo, filtered by status, with a
 * "Resend now" for the ones that didn't go through.
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { addQueryArgs, removeQueryArgs } from '@wordpress/url';
import { useEffect, useState } from '@wordpress/element';
import { Button, ExternalLink, Notice, Spinner } from '@wordpress/components';

const STATUSES = () => [
	[ '', __( 'All', 'forms-to-odoo' ) ],
	[ 'failed', __( 'Failed', 'forms-to-odoo' ) ],
	[ 'pending', __( 'Retrying', 'forms-to-odoo' ) ],
	[ 'sent', __( 'Sent', 'forms-to-odoo' ) ],
];

export default function LogTab( { initialStatus, retentionDays, onCounts } ) {
	const [ status, setStatus ] = useState( initialStatus );
	const [ page, setPage ] = useState( 1 );
	const [ log, setLog ] = useState( null ); // { items, total, pages, counts }
	const [ error, setError ] = useState( '' );
	const [ resending, setResending ] = useState( 0 );
	const [ notice, setNotice ] = useState( null );

	useEffect( () => {
		let live = true;
		setError( '' );
		apiFetch( {
			path: addQueryArgs( '/fto/v1/log', { status, page } ),
		} ).then(
			( r ) => {
				if ( ! live ) {
					return;
				}
				setLog( r );
				onCounts( r.counts );
			},
			( e ) => live && setError( e.message )
		);
		return () => {
			live = false;
		};
	}, [ status, page ] ); // eslint-disable-line react-hooks/exhaustive-deps

	const filter = ( next ) => {
		setStatus( next );
		setPage( 1 );
		// keep the filter in the URL, e.g. for the failed sends notice
		window.history.replaceState(
			null,
			'',
			next
				? addQueryArgs( window.location.href, { status: next } )
				: removeQueryArgs( window.location.href, 'status' )
		);
	};

	const resend = ( id ) => {
		setResending( id );
		setNotice( null );
		apiFetch( { path: `/fto/v1/log/${ id }/resend`, method: 'POST' } )
			.then(
				( r ) => {
					setLog( ( l ) => ( {
						...l,
						counts: r.counts,
						items: l.items.map( ( item ) =>
							item.id === id ? r.entry : item
						),
					} ) );
					onCounts( r.counts );
					setNotice(
						r.sent
							? {
									status: 'success',
									message: __(
										'Sent to Odoo.',
										'forms-to-odoo'
									),
								}
							: {
									status: 'error',
									message: __(
										"Still couldn't be sent, see the error below.",
										'forms-to-odoo'
									),
								}
					);
				},
				( e ) => setNotice( { status: 'error', message: e.message } )
			)
			.finally( () => setResending( 0 ) );
	};

	if ( error ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ error }
			</Notice>
		);
	}
	if ( ! log ) {
		return <Spinner />;
	}

	const total = log.counts.sent + log.counts.pending + log.counts.failed;

	return (
		<div className="fto-log">
			{ notice && (
				<Notice
					status={ notice.status }
					onRemove={ () => setNotice( null ) }
				>
					{ notice.message }
				</Notice>
			) }

			<div className="fto-filters">
				{ STATUSES().map( ( [ key, label ] ) => (
					<Button
						key={ key || 'all' }
						variant="tertiary"
						size="compact"
						isPressed={ status === key }
						onClick={ () => filter( key ) }
					>
						{ `${ label } (${ key ? log.counts[ key ] : total })` }
					</Button>
				) ) }
			</div>

			<table className="widefat striped">
				<thead>
					<tr>
						<th>{ __( 'Date', 'forms-to-odoo' ) }</th>
						<th>{ __( 'Form', 'forms-to-odoo' ) }</th>
						<th>{ __( 'Status', 'forms-to-odoo' ) }</th>
						<th>{ __( 'Odoo record', 'forms-to-odoo' ) }</th>
						<th className="fto-details-column">
							{ __( 'Details', 'forms-to-odoo' ) }
						</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{ ! log.items.length && (
						<tr>
							<td colSpan="6">
								{ __( 'Nothing sent yet.', 'forms-to-odoo' ) }
							</td>
						</tr>
					) }
					{ log.items.map( ( entry ) => (
						<LogRow
							key={ entry.id }
							entry={ entry }
							resending={ resending === entry.id }
							disabled={ !! resending }
							onResend={ () => resend( entry.id ) }
						/>
					) ) }
				</tbody>
			</table>

			{ log.pages > 1 && (
				<div className="fto-pagination">
					<Button
						variant="secondary"
						size="compact"
						disabled={ page <= 1 }
						onClick={ () => setPage( page - 1 ) }
					>
						{ __( 'Previous', 'forms-to-odoo' ) }
					</Button>
					<span>
						{ sprintf(
							/* translators: 1: current page, 2: number of pages */
							__( 'Page %1$d of %2$d', 'forms-to-odoo' ),
							page,
							log.pages
						) }
					</span>
					<Button
						variant="secondary"
						size="compact"
						disabled={ page >= log.pages }
						onClick={ () => setPage( page + 1 ) }
					>
						{ __( 'Next', 'forms-to-odoo' ) }
					</Button>
				</div>
			) }

			<p className="description">
				{ sprintf(
					/* translators: %d: number of days */
					__(
						"Sends that fail because Odoo can't be reached are retried automatically after 5 min, 30 min, 2 h and 12 h. Entries are deleted after %d days, as they contain submitted personal data.",
						'forms-to-odoo'
					),
					retentionDays
				) }
			</p>
		</div>
	);
}

function LogRow( { entry, resending, disabled, onResend } ) {
	const labels = {
		sent: __( 'Sent', 'forms-to-odoo' ),
		pending: __( 'Retrying', 'forms-to-odoo' ),
		failed: __( 'Failed', 'forms-to-odoo' ),
	};
	const json = ( value ) => JSON.stringify( value, null, 2 );

	return (
		<tr>
			<td>{ entry.date }</td>
			<td>
				<a href={ entry.formUrl }>{ entry.formTitle }</a>
				<br />
				<code>{ entry.model }</code>
			</td>
			<td>
				<span className={ `fto-badge is-${ entry.status }` }>
					{ labels[ entry.status ] || entry.status }
				</span>
				<br />
				<small>
					{ sprintf(
						/* translators: %d: number of attempts */
						_n(
							'%d attempt',
							'%d attempts',
							entry.attempts,
							'forms-to-odoo'
						),
						entry.attempts
					) }
					{ entry.nextAttempt && (
						<>
							<br />
							{ sprintf(
								/* translators: %s: date and time */
								__( 'next: %s', 'forms-to-odoo' ),
								entry.nextAttempt
							) }
						</>
					) }
				</small>
			</td>
			<td>
				{ entry.odooId ? (
					<ExternalLink
						href={ entry.odooUrl }
					>{ `#${ entry.odooId }` }</ExternalLink>
				) : (
					'–'
				) }
				{ entry.partnerId > 0 && entry.model === 'res.partner' && (
					<>
						<br />
						<small>
							{ __(
								'existing contact, not duplicated',
								'forms-to-odoo'
							) }
						</small>
					</>
				) }
				{ entry.partnerId > 0 && entry.model !== 'res.partner' && (
					<>
						<br />
						<small>
							{ __( 'Contact:', 'forms-to-odoo' ) }{ ' ' }
							<ExternalLink
								href={ entry.partnerUrl }
							>{ `#${ entry.partnerId }` }</ExternalLink>
						</small>
					</>
				) }
			</td>
			<td>
				{ entry.error && (
					<div className="fto-error">{ entry.error }</div>
				) }
				<details>
					<summary>{ __( 'Sent values', 'forms-to-odoo' ) }</summary>
					<pre>{ json( entry.payload ) }</pre>
				</details>
				{ entry.contact && (
					<details>
						<summary>
							{ __( 'Contact lookup', 'forms-to-odoo' ) }
						</summary>
						<pre>{ json( entry.contact ) }</pre>
					</details>
				) }
			</td>
			<td>
				{ entry.status !== 'sent' && (
					<Button
						variant="secondary"
						size="compact"
						isBusy={ resending }
						disabled={ disabled }
						onClick={ onResend }
					>
						{ __( 'Resend now', 'forms-to-odoo' ) }
					</Button>
				) }
			</td>
		</tr>
	);
}
