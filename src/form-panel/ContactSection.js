/**
 * Odoo contact found by the submitted email (or created) and set on the
 * record; for a form creating contacts, reused instead of duplicated.
 */
import { __ } from '@wordpress/i18n';
import { useEffect } from '@wordpress/element';
import { CheckboxControl } from '@wordpress/components';
import { data, usePanel } from './data';
import { HelpTip, Select, TemplateInput } from './controls';

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
	// one contact (e.g. a lead's Customer) or several (a booking's Attendees)
	const partnerFields = Object.entries( fields ).filter(
		( [ , f ] ) =>
			[ 'many2one', 'many2many' ].includes( f.type ) &&
			f.relation === 'res.partner'
	);
	const pick = ( field ) => ( {
		...contact,
		field,
		multi: fields[ field ]?.type === 'many2many',
	} );
	const fieldOk = partnerFields.some(
		( [ name ] ) => name === contact.field
	);

	// the saved field isn't on this model (anymore): partner_id, then
	// partner_ids (a booking's attendees), else the first one
	useEffect( () => {
		if ( isPartner || fieldOk || ! partnerFields.length ) {
			return;
		}
		const names = partnerFields.map( ( [ name ] ) => name );
		const fallback =
			[ 'partner_id', 'partner_ids' ].find( ( n ) =>
				names.includes( n )
			) || names[ 0 ];
		setContact( pick( fallback ) );
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
				<HelpTip
					text={ __(
						'In Odoo, a contact is a person or company in the shared address book (res.partner). Leads, tickets and tasks link to one through a field such as Customer (partner_id).',
						'forms-to-odoo'
					) }
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
				<table className="widefat fto-mapping fto-contact-table">
					<thead>
						<tr>
							<th>{ __( 'Contact', 'forms-to-odoo' ) }</th>
							<th>{ __( 'Value', 'forms-to-odoo' ) }</th>
						</tr>
					</thead>
					<tbody>
						<Row
							label={ __( 'Email', 'forms-to-odoo' ) }
							help={ __(
								'Look for existing contact with this email',
								'forms-to-odoo'
							) }
						>
							<TemplateInput
								label={ __( 'Email', 'forms-to-odoo' ) }
								hideLabelFromVision
								value={ contact.email || '' }
								onChange={ set( 'email' ) }
							/>
						</Row>
						{ ! isPartner && (
							<>
								<Row
									label={ __( 'Set it in', 'forms-to-odoo' ) }
									help={ __(
										'The record field that links to the contact',
										'forms-to-odoo'
									) }
								>
									<Select
										label={ __(
											'Set it in',
											'forms-to-odoo'
										) }
										hideLabelFromVision
										showSelectedHint
										value={ contact.field }
										options={ partnerFields.map(
											( [ name, f ] ) => ( {
												value: name,
												label: f.label,
												hint: name,
											} )
										) }
										onChange={ ( field ) =>
											setContact( pick( field ) )
										}
									/>
								</Row>
								<Row
									label={ __(
										'What to do if no contact exists with this email',
										'forms-to-odoo'
									) }
								>
									<CheckboxControl
										__nextHasNoMarginBottom
										label={ __(
											'Create the contact',
											'forms-to-odoo'
										) }
										help={
											contact.create
												? null
												: __(
														'The record is sent without a contact.',
														'forms-to-odoo'
													)
										}
										checked={ !! contact.create }
										onChange={ set( 'create' ) }
									/>
								</Row>
								{ contact.create && (
									<>
										<Row
											label={ __(
												'Name',
												'forms-to-odoo'
											) }
											help={ __(
												'Of the new contact',
												'forms-to-odoo'
											) }
										>
											<TemplateInput
												label={ __(
													'Name',
													'forms-to-odoo'
												) }
												hideLabelFromVision
												placeholder={ __(
													'e.g. [your-name] (the email if empty)',
													'forms-to-odoo'
												) }
												value={ contact.name || '' }
												onChange={ set( 'name' ) }
											/>
										</Row>
										<Row
											label={ __(
												'Phone',
												'forms-to-odoo'
											) }
											help={ __(
												'Of the new contact',
												'forms-to-odoo'
											) }
										>
											<TemplateInput
												label={ __(
													'Phone',
													'forms-to-odoo'
												) }
												hideLabelFromVision
												value={ contact.phone || '' }
												onChange={ set( 'phone' ) }
											/>
										</Row>
									</>
								) }
							</>
						) }
					</tbody>
				</table>
			) }
		</div>
	);
}

// A row like the mapping's: what it is on the left, the control on the right
function Row( { label, help, children } ) {
	return (
		<tr>
			<td>
				<strong>{ label }</strong>
				{ help && <div className="description">{ help }</div> }
			</td>
			<td>{ children }</td>
		</tr>
	);
}
