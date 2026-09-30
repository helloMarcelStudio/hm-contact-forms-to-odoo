/**
 * Connection tab: Odoo URL, database and API key, and a connection test.
 */
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useEffect, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	Notice,
	Spinner,
	TextControl,
} from '@wordpress/components';

export default function ConnectionTab() {
	const [ saved, setSaved ] = useState( null ); // what the server has
	const [ form, setForm ] = useState( { url: '', db: '', api_key: '' } );
	const [ busy, setBusy ] = useState( '' ); // '' | 'save' | 'test'
	const [ notice, setNotice ] = useState( null ); // { status, message }

	const load = ( connection ) => {
		setSaved( connection );
		setForm( { url: connection.url, db: connection.db, api_key: '' } );
	};

	useEffect( () => {
		apiFetch( { path: '/fto/v1/settings' } ).then( load, ( e ) =>
			setNotice( { status: 'error', message: e.message } )
		);
	}, [] );

	if ( ! saved ) {
		return notice ? (
			<Notice status="error" isDismissible={ false }>
				{ notice.message }
			</Notice>
		) : (
			<Spinner />
		);
	}

	const dirty =
		form.url !== saved.url || form.db !== saved.db || form.api_key !== '';
	const fromConfig = ( key ) =>
		saved.constants[ key ]
			? __( 'Set in wp-config.php', 'forms-to-odoo' )
			: '';
	const set = ( key ) => ( value ) => setForm( { ...form, [ key ]: value } );

	const save = ( e ) => {
		e.preventDefault();
		setBusy( 'save' );
		setNotice( null );
		apiFetch( { path: '/fto/v1/settings', method: 'POST', data: form } )
			.then(
				( connection ) => {
					load( connection );
					setNotice( {
						status: 'success',
						message: __( 'Settings saved.', 'forms-to-odoo' ),
					} );
				},
				( err ) =>
					setNotice( { status: 'error', message: err.message } )
			)
			.finally( () => setBusy( '' ) );
	};

	const test = () => {
		setBusy( 'test' );
		setNotice( null );
		apiFetch( { path: '/fto/v1/test', method: 'POST' } )
			.then(
				( r ) =>
					setNotice( {
						status: 'success',
						message: sprintf(
							/* translators: 1: Odoo user name, 2: login, 3: Odoo version */
							__(
								'Connected as %1$s (%2$s) to Odoo %3$s.',
								'forms-to-odoo'
							),
							r.user,
							r.login,
							r.version ||
								__( '(version unknown)', 'forms-to-odoo' )
						),
					} ),
				( err ) =>
					setNotice( {
						status: 'error',
						message:
							__( 'Connection failed:', 'forms-to-odoo' ) +
							' ' +
							err.message,
					} )
			)
			.finally( () => setBusy( '' ) );
	};

	return (
		<Card className="fto-connection">
			<CardBody>
				{ notice && (
					<Notice
						status={ notice.status }
						onRemove={ () => setNotice( null ) }
					>
						{ notice.message }
					</Notice>
				) }
				<form onSubmit={ save } className="fto-connection-form">
					<TextControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						type="url"
						label={ __( 'Odoo URL', 'forms-to-odoo' ) }
						placeholder={
							fromConfig( 'url' ) || 'https://mycompany.odoo.com'
						}
						value={ form.url }
						onChange={ set( 'url' ) }
					/>
					<TextControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Database', 'forms-to-odoo' ) }
						help={ __(
							'Only needed when your Odoo server hosts several databases.',
							'forms-to-odoo'
						) }
						placeholder={ fromConfig( 'db' ) }
						value={ form.db }
						onChange={ set( 'db' ) }
					/>
					<TextControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						type="password"
						autoComplete="new-password"
						label={ __( 'API key', 'forms-to-odoo' ) }
						help={ __(
							"Created in Odoo under your user's Preferences → Account Security → New API Key. Never displayed once saved. Records are created with that user's access rights.",
							'forms-to-odoo'
						) }
						placeholder={
							saved.hasKey
								? __(
										'•••••••• (leave blank to keep the current key)',
										'forms-to-odoo'
									)
								: fromConfig( 'api_key' )
						}
						value={ form.api_key }
						onChange={ set( 'api_key' ) }
					/>
					<div className="fto-actions">
						<Button
							type="submit"
							variant="primary"
							isBusy={ busy === 'save' }
							disabled={ !! busy || ! dirty }
						>
							{ __( 'Save', 'forms-to-odoo' ) }
						</Button>
						<Button
							variant="secondary"
							isBusy={ busy === 'test' }
							disabled={ !! busy || dirty || ! saved.configured }
							onClick={ test }
							label={
								dirty
									? __(
											'Save your changes first.',
											'forms-to-odoo'
										)
									: undefined
							}
							showTooltip={ dirty }
						>
							{ __( 'Test connection', 'forms-to-odoo' ) }
						</Button>
					</div>
				</form>
				<p className="description">
					{ __(
						'Requires Odoo 19 or later (JSON-2 API). Forms are connected one by one: edit a form in Contact → Contact Forms and open its "Odoo" tab.',
						'forms-to-odoo'
					) }
				</p>
			</CardBody>
		</Card>
	);
}
