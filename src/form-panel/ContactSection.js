/**
 * Odoo contact found by the submitted email (or created) and set on the
 * record; for a form creating contacts, reused instead of duplicated.
 */
import { __ } from '@wordpress/i18n';
import { useEffect } from '@wordpress/element';
import { Button, CheckboxControl, SelectControl } from '@wordpress/components';
import { data, usePanel } from './data';
import { TemplateInput } from './controls';

// First guess from the form's tag names, e.g. [your-email]
function guessTemplates( contact ) {
	const find = ( re ) => ( data.tags || [] ).filter( ( t ) => re.test( t ) );
	const join = ( tags, n ) =>
		tags
			.slice( 0, n )
			.map( ( t ) => `[${ t }]` )
			.join( ' ' );
	return {
		email: contact.email || join( find( /mail/i ), 1 ),
		name:
			contact.name ||
			join(
				find( /name/i ).filter( ( t ) => ! /company|user/i.test( t ) ),
				2
			),
		phone: contact.phone || join( find( /phone|tel|gsm|mobile/i ), 1 ),
	};
}

export default function ContactSection( { model, contact, setContact } ) {
	const { fields } = usePanel();
	const isPartner = model === 'res.partner';
	const partnerFields = Object.entries( fields ).filter(
		( [ , f ] ) => f.type === 'many2one' && f.relation === 'res.partner'
	);
	const fieldOk = partnerFields.some(
		( [ name ] ) => name === contact.field
	);

	// the saved field isn't on this model (anymore): partner_id, else the first one
	useEffect( () => {
		if ( isPartner || fieldOk || ! partnerFields.length ) {
			return;
		}
		const fallback = partnerFields.some(
			( [ name ] ) => name === 'partner_id'
		)
			? 'partner_id'
			: partnerFields[ 0 ][ 0 ];
		setContact( { ...contact, field: fallback } );
	}, [ isPartner, fieldOk, partnerFields.length ] ); // eslint-disable-line react-hooks/exhaustive-deps

	if ( ! isPartner && ! partnerFields.length ) {
		return null;
	}
	const set = ( key ) => ( value ) =>
		setContact( { ...contact, [ key ]: value } );

	return (
		<div className="fto-contact">
			<h3 className="fto-heading-help">
				{ __( 'Contact', 'forms-to-odoo' ) }
				<Button
					icon="info-outline"
					size="small"
					label={ __(
						'In Odoo, a contact is a person or company in the shared address book (res.partner). Leads, tickets and tasks link to one through a field such as Customer (partner_id).',
						'forms-to-odoo'
					) }
					showTooltip
				/>
			</h3>
			<CheckboxControl
				__nextHasNoMarginBottom
				label={
					isPartner
						? __(
								"Don't create duplicates: when a contact with this email exists, reuse it",
								'forms-to-odoo'
							)
						: __(
								'Link to an Odoo contact, found by email',
								'forms-to-odoo'
							)
				}
				help={
					isPartner
						? __(
								'Nothing is created or changed in Odoo then; the log links to the existing contact.',
								'forms-to-odoo'
							)
						: __(
								'The contact with the submitted email is set on the record, so each person has a single contact in Odoo.',
								'forms-to-odoo'
							)
				}
				checked={ !! contact.enabled }
				onChange={ ( enabled ) =>
					setContact( {
						...contact,
						...( enabled ? guessTemplates( contact ) : {} ),
						enabled,
					} )
				}
			/>
			{ contact.enabled && (
				<div className="fto-contact-fields">
					<TemplateInput
						label={ __( 'Email', 'forms-to-odoo' ) }
						value={ contact.email || '' }
						onChange={ set( 'email' ) }
					/>
					{ ! isPartner && (
						<>
							<SelectControl
								__nextHasNoMarginBottom
								__next40pxDefaultSize
								label={ __( 'Set it in', 'forms-to-odoo' ) }
								value={ contact.field }
								options={ partnerFields.map(
									( [ name, f ] ) => ( {
										value: name,
										label: `${ f.label } — ${ name }`,
									} )
								) }
								onChange={ set( 'field' ) }
							/>
							<CheckboxControl
								__nextHasNoMarginBottom
								label={ __(
									'Create the contact when none has this email',
									'forms-to-odoo'
								) }
								checked={ !! contact.create }
								onChange={ set( 'create' ) }
							/>
							{ contact.create && (
								<>
									<TemplateInput
										label={ __( 'Name', 'forms-to-odoo' ) }
										placeholder={ __(
											'e.g. [your-name] (the email if empty)',
											'forms-to-odoo'
										) }
										value={ contact.name || '' }
										onChange={ set( 'name' ) }
									/>
									<TemplateInput
										label={ __( 'Phone', 'forms-to-odoo' ) }
										value={ contact.phone || '' }
										onChange={ set( 'phone' ) }
									/>
								</>
							) }
						</>
					) }
				</div>
			) }
		</div>
	);
}
